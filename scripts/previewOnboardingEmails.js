import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../output/onboarding-step5');
if (!fs.existsSync(path.join(folder, 'report.json'))) throw new Error('Run the local rehearsal first.');
const app = express();
app.get('/', (_req, res) => res.type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pruebas de correos Volta</title><body style="font:18px system-ui;max-width:800px;margin:40px auto;padding:20px"><h1>Correos del onboarding</h1><p>Ensayo local: datos ficticios, sin envíos externos. Los enlaces de alta de estos ejemplos no están activos.</p><ol>${[1,2,3,7,8,9].map(n => `<li><a href="/email-${n}.html">${({1:'Solicitud',2:'Oferta al contado',3:'Bienvenida',7:'Solicitud de renting',8:'Oferta de renting',9:'Bienvenida reenviada'})[n]}</a></li>`).join('')}</ol></body></html>`));
app.get('/email-:number.html', (req, res) => {
  if (!/^[1-9]$/.test(req.params.number)) return res.sendStatus(404);
  const file = path.join(folder, `email-${req.params.number}.html`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  // No external QR requests and no live actions from captured rehearsal mail.
  const body = fs.readFileSync(file, 'utf8').replace(/<img\b[^>]*>/g, '<p>QR de ejemplo</p>').replace(/href="[^"]*"/g, 'href="#"');
  res.type('html').send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Correo de prueba ${req.params.number}</title><body style="margin:0">${body}</body></html>`);
});
app.listen(4186, '127.0.0.1', () => console.log('Email preview: http://127.0.0.1:4186'));
