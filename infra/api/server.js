import express from 'express'

const app = express()

app.get('/', (_req, res) => {
  res.send('DEVATA API: ok')
})

app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`DEVATA demo API listening on :${port}`)
})
