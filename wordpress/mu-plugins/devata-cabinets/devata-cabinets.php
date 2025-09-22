<?php
/**
 * Plugin Name: DEVATA Cabinets
 * Description: Custom role dashboards and REST endpoints for DEVATA without third-party plugins.
 * Author: DEVATA
 * Version: 0.1.0
 */

defined('ABSPATH') || exit;

if (! class_exists('Devata_Cabinets')) {
    final class Devata_Cabinets
    {
        private const VERSION = '0.1.0';
        private const REST_NAMESPACE = 'devata/v1';

        private static bool $assetsEnqueued = false;

        public static function init(): void
        {
            add_action('init', [__CLASS__, 'register_roles']);
            add_action('init', [__CLASS__, 'register_shortcodes']);
            add_action('rest_api_init', [__CLASS__, 'register_rest_routes']);
            add_action('wp_enqueue_scripts', [__CLASS__, 'register_assets']);
            add_filter('devata_cabinets_user_payload', [__CLASS__, 'append_user_profile_fields'], 10, 2);
        }

        public static function register_roles(): void
        {
            $roles = [
                'partner' => [
                    'name' => __('DEVATA Partner', 'devata-cabinets'),
                    'capabilities' => [
                        'read' => true,
                    ],
                ],
                'student' => [
                    'name' => __('DEVATA Student', 'devata-cabinets'),
                    'capabilities' => [
                        'read' => true,
                    ],
                ],
                'staff' => [
                    'name' => __('DEVATA Staff', 'devata-cabinets'),
                    'capabilities' => [
                        'read' => true,
                        'edit_posts' => false,
                    ],
                ],
                'branch_admin' => [
                    'name' => __('DEVATA Branch Administrator', 'devata-cabinets'),
                    'capabilities' => [
                        'read' => true,
                        'list_users' => true,
                    ],
                ],
            ];

            foreach ($roles as $key => $role) {
                $roleKey = 'devata_' . $key;
                if (! get_role($roleKey)) {
                    add_role($roleKey, $role['name'], $role['capabilities']);
                }
            }
        }

        public static function register_shortcodes(): void
        {
            add_shortcode('devata_dashboard', fn() => self::render_portal('dashboard'));
            add_shortcode('devata_partner', fn() => self::render_portal('partner'));
            add_shortcode('devata_student', fn() => self::render_portal('student'));
            add_shortcode('devata_staff', fn() => self::render_portal('staff'));
            add_shortcode('devata_branch', fn() => self::render_portal('branch'));
        }

        private static function render_portal(string $view): string
        {
            if (! is_user_logged_in()) {
                return self::render_login_prompt();
            }

            $user = wp_get_current_user();
            if (! $user instanceof WP_User) {
                return self::render_login_prompt();
            }

            self::enqueue_assets($view);

            return sprintf(
                '<div class="devata-cabinet" data-devata-view="%1$s" data-devata-user="%2$s"></div>',
                esc_attr($view),
                esc_attr((string) $user->ID)
            );
        }

        private static function render_login_prompt(): string
        {
            $requestedUri = $_SERVER['REQUEST_URI'] ?? '/';
            $redirect = home_url($requestedUri);
            $loginUrl = esc_url(wp_login_url($redirect));
            return sprintf(
                '<div class="devata-cabinet-login">%s <a href="%s">%s</a></div>',
                esc_html__('Необходимо войти, чтобы увидеть кабинет.', 'devata-cabinets'),
                $loginUrl,
                esc_html__('Войти', 'devata-cabinets')
            );
        }

        public static function register_assets(): void
        {
            $pluginUrl = plugin_dir_url(__FILE__);
            wp_register_style(
                'devata-cabinets',
                $pluginUrl . 'assets/css/cabinets.css',
                [],
                self::VERSION
            );
            wp_register_script(
                'devata-cabinets',
                $pluginUrl . 'assets/js/cabinets.js',
                [],
                self::VERSION,
                true
            );
        }

        private static function enqueue_assets(string $view): void
        {
            if (! self::$assetsEnqueued) {
                wp_enqueue_style('devata-cabinets');
                wp_enqueue_script('devata-cabinets');

                $config = [
                    'restUrl' => esc_url_raw(rest_url(self::REST_NAMESPACE . '/')),
                    'nonce' => wp_create_nonce('wp_rest'),
                    'view' => $view,
                    'i18n' => [
                        'loading' => __('Загружаем данные...', 'devata-cabinets'),
                        'error' => __('Не удалось загрузить кабинет. Попробуйте обновить страницу.', 'devata-cabinets'),
                        'empty' => __('Нет данных для отображения.', 'devata-cabinets'),
                        'profileUpdated' => __('Профиль обновлён', 'devata-cabinets'),
                    ],
                ];

                wp_localize_script('devata-cabinets', 'DevataCabinetsSettings', $config);
                self::$assetsEnqueued = true;
            }
        }

        public static function register_rest_routes(): void
        {
            register_rest_route(
                self::REST_NAMESPACE,
                '/me',
                [
                    [
                        'methods' => WP_REST_Server::READABLE,
                        'callback' => [__CLASS__, 'handle_get_me'],
                        'permission_callback' => [__CLASS__, 'require_authenticated_user'],
                    ],
                ]
            );

            register_rest_route(
                self::REST_NAMESPACE,
                '/me/profile',
                [
                    [
                        'methods' => WP_REST_Server::EDITABLE,
                        'callback' => [__CLASS__, 'handle_update_profile'],
                        'permission_callback' => [__CLASS__, 'require_authenticated_user'],
                    ],
                ]
            );

            $collections = ['bookings', 'orders', 'courses', 'network', 'payouts'];
            foreach ($collections as $collection) {
                register_rest_route(
                    self::REST_NAMESPACE,
                    '/me/' . $collection,
                    [
                        [
                            'methods' => WP_REST_Server::READABLE,
                            'callback' => fn(WP_REST_Request $request) => self::handle_collection($request, $collection),
                            'permission_callback' => [__CLASS__, 'require_authenticated_user'],
                        ],
                    ]
                );
            }
        }

        public static function require_authenticated_user(): bool|
        WP_Error {
            if (! is_user_logged_in()) {
                return new WP_Error('devata_auth_required', __('Необходима авторизация', 'devata-cabinets'), ['status' => 401]);
            }
            return true;
        }

        public static function handle_get_me(WP_REST_Request $request): WP_REST_Response
        {
            $user = wp_get_current_user();
            $payload = [
                'id' => $user->ID,
                'displayName' => $user->display_name,
                'email' => $user->user_email,
                'roles' => $user->roles,
                'avatar' => get_avatar_url($user->ID),
                'profile' => [
                    'firstName' => get_user_meta($user->ID, 'first_name', true),
                    'lastName' => get_user_meta($user->ID, 'last_name', true),
                    'phone' => get_user_meta($user->ID, 'phone', true),
                    'telegram' => get_user_meta($user->ID, 'telegram', true),
                ],
            ];

            /** @var array<string, mixed> $payload */
            $payload = apply_filters('devata_cabinets_user_payload', $payload, $user);

            return new WP_REST_Response($payload);
        }

        public static function append_user_profile_fields(array $payload, WP_User $user): array
        {
            $meta = get_user_meta($user->ID, 'devata_additional_meta', true);
            if (is_array($meta)) {
                $payload['meta'] = $meta;
            }
            return $payload;
        }

        public static function handle_update_profile(WP_REST_Request $request): WP_REST_Response
        {
            $user = wp_get_current_user();
            $params = $request->get_json_params();

            $allowedFields = ['firstName', 'lastName', 'phone', 'telegram'];
            $updated = [];

            foreach ($allowedFields as $field) {
                if (array_key_exists($field, $params)) {
                    $value = is_string($params[$field]) ? wp_unslash($params[$field]) : '';
                    switch ($field) {
                        case 'firstName':
                            update_user_meta($user->ID, 'first_name', $value);
                            $updated['firstName'] = $value;
                            break;
                        case 'lastName':
                            update_user_meta($user->ID, 'last_name', $value);
                            $updated['lastName'] = $value;
                            break;
                        case 'phone':
                            update_user_meta($user->ID, 'phone', $value);
                            $updated['phone'] = $value;
                            break;
                        case 'telegram':
                            update_user_meta($user->ID, 'telegram', $value);
                            $updated['telegram'] = $value;
                            break;
                    }
                }
            }

            do_action('devata_cabinets_profile_updated', $user->ID, $updated);

            return new WP_REST_Response([
                'success' => true,
                'profile' => $updated,
            ]);
        }

        private static function handle_collection(WP_REST_Request $request, string $collection): WP_REST_Response
        {
            $user = wp_get_current_user();

            /**
             * Filter the cabinet collection response.
             *
             * @param array<int, array<string, mixed>> $items
             * @param string $collection
             * @param WP_User $user
             * @param WP_REST_Request $request
             */
            $items = apply_filters('devata_cabinets_' . $collection, [], $user, $request);

            if (! is_array($items)) {
                $items = [];
            }

            return new WP_REST_Response([
                'items' => array_values($items),
                'generatedAt' => current_time('c'),
            ]);
        }
    }

    Devata_Cabinets::init();
}
