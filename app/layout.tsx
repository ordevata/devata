
import './globals.css'
import Link from 'next/link'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="border-b">
          <div className="container flex gap-6 py-3 items-center">
            <Link href="/" className="font-semibold">DEVATA</Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/centers">Центры</Link>
              <Link href="/specialists">Специалисты</Link>
              <Link href="/courses">Обучение</Link>
              <Link href="/partner/tree">Партнёр</Link>
              <Link href="/lecturer/cohorts">Лектор</Link>
              <Link href="/assistant/cohorts">Ассистент</Link>
              <Link href="/center/dashboard">Центр</Link>
              <Link href="/admin/approvals">Админ</Link>
            </nav>
          </div>
        </header>
        <main className="container py-6">{children}</main>
      </body>
    </html>
  )
}
