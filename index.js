// index.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode'); // pra gerar QR em imagem
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());

// 🔒 Ajuste CORS: troque pelo domínio do teu Pages quando publicar o backend
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:13000',
  'https://SEU-USUARIO.github.io' // <-- troque SEU-USUARIO
];
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))),
}));

const PORTA = process.env.PORT || 8080; // obrigatório em hosts
const clientId = process.env.WPP_CLIENT_ID || 'Financeiro';

let enviosHoje = 0;
let pronto = false;
let ultimoQRDataUrl = '';

const client = new Client({
  authStrategy: new LocalAuth({ clientId }),
  puppeteer: {
    headless: true, // em servidor tem que ser headless
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote'
    ]
  }
});

// Exibe QR no log (se quiser ver nos "Logs" do host)
client.on('qr', qr => {
  console.log('Escaneie o QR code abaixo para autenticar:');
  qrcodeTerminal.generate(qr, { small: true });
  // Gera também versão imagem pra rota /qr
  QRCode.toDataURL(qr).then(dataUrl => { ultimoQRDataUrl = dataUrl; }).catch(() => {});
});

client.on('ready', () => {
  console.log('Cliente WhatsApp pronto para uso.');
  pronto = true;
});

client.initialize();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getSmartDelay(envios) {
  if (envios < 10) return 15000 + Math.random() * 15000;
  if (envios < 30) return 30000 + Math.random() * 30000;
  if (envios < 50) return 60000 + Math.random() * 60000;
  return 120000 + Math.random() * 180000;
}

function limparNumero(numero) { return String(numero).replace(/\D/g, ''); }

async function enviarMensagem(numero, mensagem) {
  const num = limparNumero(numero);
  const chatId = await client.getNumberId(num);
  if (!chatId) return { numero, status: 'Número inválido' };

  const chat = await client.getChatById(chatId._serialized);
  await chat.sendStateTyping();
  await sleep(2000 + Math.random() * 3000);
  await chat.clearState();
  await sleep(500 + Math.random() * 1000);

  await client.sendMessage(chatId._serialized, mensagem);
  return { numero, status: 'Enviado com sucesso' };
}

function salvarHistorico(titulo, dados) {
  try {
    const data = new Date();
    const dia = data.toISOString().split('T')[0];
    const pasta = path.join(__dirname, 'historico', dia);
    fs.mkdirSync(pasta, { recursive: true });
    const nomeBase = (titulo?.trim() || `envio-${Date.now()}`).replace(/[^\w\d-_]/g, '_');
    const nomeArquivo = path.join(pasta, `${nomeBase}.json`);
    fs.writeFileSync(nomeArquivo, JSON.stringify(dados, null, 2), 'utf-8');
    console.log(`📁 Histórico salvo em: ${nomeArquivo}`);
  } catch (e) {
    console.warn('Não foi possível salvar histórico (FS possivelmente efêmero no host).');
  }
}

// API
app.get('/health', (_, res) => res.json({ ok: true, pronto, enviosHoje, now: new Date().toISOString() }));
app.get('/qr', (req, res) => {
  if (!ultimoQRDataUrl) return res.status(404).send('QR ainda não gerado; confira os logs.');
  res.type('html').send(`<img src="${ultimoQRDataUrl}" style="width:320px;height:320px;border:1px solid #ccc"/>`);
});

app.post('/enviar', async (req, res) => {
  if (!pronto) return res.status(503).json({ erro: 'WhatsApp inicializando...' });
  const { numeros, mensagem, dadosCliente, titulo } = req.body;
  if (!Array.isArray(numeros) || !mensagem) return res.status(400).json({ erro: 'Payload inválido.' });

  const resultados = [];
  for (let numero of numeros) {
    if (enviosHoje >= 100) { resultados.push({ numero, status: 'Limite diário atingido' }); continue; }
    const texto = mensagem // simples personalização básica
      .replace(/{nome}/gi, dadosCliente?.nome || '')
      .replace(/{empresa}/gi, dadosCliente?.empresa || '')
      .replace(/{cidade}/gi, dadosCliente?.cidade || '');
    const r = await enviarMensagem(numero, texto);
    resultados.push(r);
    enviosHoje++;
    await sleep(getSmartDelay(enviosHoje));
  }

  salvarHistorico(titulo, {
    titulo: titulo || '',
    dataEnvio: new Date().toISOString(),
    remetente: clientId,
    total: resultados.length,
    mensagemOriginal: mensagem,
    dadosCliente,
    resultados
  });

  res.json({ total: enviosHoje, resultados });
});

app.listen(PORTA, () => console.log(`Servidor na porta ${PORTA}`));
