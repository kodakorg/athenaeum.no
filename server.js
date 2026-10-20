// server.js
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');
const morgan = require('morgan')
const favicon = require('serve-favicon');
const path = require("path");
const axios = require('axios');
require('dotenv').config()
const rfs = require('rotating-file-stream');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const compression = require('compression');

if (process.env.ENABLE_FILE_LOGGING === 'true') {
  const accessLogStream = rfs.createStream('access.log', {
    interval: '1d',
    maxFiles: 30,
    path: path.join(__dirname, 'logs'),
    compress: 'gzip'
  });

  morgan.format('file', [
    ':req[x-forwarded-for]',
    '[:date[clf]]',
    '":method :url HTTP/:http-version"',
    ':status',
    ':res[content-length]',
    ':response-time ms',
    '":referrer"',
    '":req[accept-language]"',
    '":user-agent"',
  ].join(' '));
  app.use(morgan('file', { stream: accessLogStream }));
} else {
  app.use(morgan('combined'));
}

app.disable('x-powered-by');
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

// CSS/JS are referenced with ?v=<hash>, so they can be cached "forever"
const assetVersion = crypto.createHash('sha1')
  .update(fsSync.readFileSync(path.join(__dirname, 'public/css/css.css')))
  .update(fsSync.readFileSync(path.join(__dirname, 'public/js/site.js')))
  .digest('hex')
  .slice(0, 10);

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(css|js|woff2)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(avif|webp|jpe?g|png|ico)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

app.set('view engine', 'ejs');
app.set('trust proxy', 1);

const NAV = [
  { href: '/', label: 'Forside' },
  { href: '/kontaktskjema', label: 'Kontaktskjema' },
  { href: '/vilkaar', label: 'Vilkår' },
  { href: '/priser', label: 'Priser' },
  { href: '/lokalene', label: 'Lokalene' },
  { href: '/kalender', label: 'Kalender' },
];

app.use(function (req, res, next) {
  res.locals.nav = NAV;
  res.locals.currentPage = NAV.find(item => item.href === req.path);
  res.locals.assetVersion = assetVersion;
  // Pages are static, so a short cache lets hover-prefetched pages be reused on click
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, max-age=60');
  }
  next();
});



const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_ADDRESS,
    pass: process.env.EMAIL_PASSWORD
  },
});

function validateEmail(email) {
  const re = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return re.test(email);
}

function escapeHtml(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Today's date in Norway as YYYY-MM-DD (same format as <input type="date">)
function todayInOslo() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
}

async function verifyRecaptcha(token) {
  try {
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: {
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: token
      }
    });
    return response.data.success;
  } catch (error) {
    console.error('reCAPTCHA verification error:', error);
    return false;
  }
}

app.get('/', function (req, res) {
  res.render('pages/forside');
});

app.get('/kalender', function (req, res) {
  res.render('pages/kalender');
});

app.get('/vilkaar', function (req, res) {
  res.render('pages/vilkaar');
});

app.get('/lokalene', function (req, res) {
  res.render('pages/lokalene');
});

app.get('/priser', function (req, res) {
  res.render('pages/priser');
});

app.get('/kontaktskjema', function (req, res) {
  res.render('pages/kontaktskjema', {
    sjekk: false,
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY,
    minDato: todayInOslo()
  });
});

app.post('/skjema', async function (req, res) {
  let mailOptions = {};
  let sjekk = false;
  let message = "";
  let navn = req.body.navn;
  let epost = req.body.epost;
  let tlf = req.body.tlf;
  let dato = req.body.dato;
  let lokaler = req.body.lokaler;
  let recaptchaToken = req.body['g-recaptcha-response'];

  if (lokaler === undefined) {
    lokaler = "Ingen lokaler valgt";
  }
  let tekst = req.body.formaal;
  const fields = [
    ["Navn", navn],
    ["Epost", epost],
    ["Telefonnummer", tlf],
    ["Dato", dato],
    ["Lokaler", lokaler],
    ["Formålet med leien", tekst],
  ];
  // User input is escaped so it can't inject markup into the email
  const html_string = fields
    .map(([label, value]) => label + ": " + escapeHtml(value).replace(/\r?\n/g, "<br>"))
    .join("<br>");
  const text_string = fields
    .map(([label, value]) => label + ": " + (value === undefined ? "" : String(value)))
    .join("\n");

  if (!recaptchaToken) {
    message = "Vennligst fullfør reCAPTCHA-verifiseringen";
  } else {
    const recaptchaValid = await verifyRecaptcha(recaptchaToken);
    if (!recaptchaValid) {
      message = "reCAPTCHA-verifisering mislyktes. Vennligst prøv igjen.";
    } else if (typeof navn === 'undefined' || navn === null || navn === '') {
      message = "Navn mangler eller er tom";
    } else if (!validateEmail(epost)) {
      message = "Epost har feil format";
    } else if (!/^[479]\d{7}$/.test(tlf)) {
      message = "Telefonnummer har feil format";
    } else if (typeof dato !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dato) || dato < todayInOslo()) {
      message = "Dato har feil format eller er i fortiden";
    } else if (typeof tekst === 'undefined' || tekst === null || tekst === '') {
      message = "Tekstfeltet er tomt";
    } else if (lokaler === "Ingen lokaler valgt") {
      message = "Du må velge et lokale";
    } else {
      sjekk = true;
      message = "Forespørsel er sendt! Vi tar kontakt med deg så snart som mulig.";
      mailOptions = {
        from: {
          name: 'Kontaktskjema Athenæum',
          address: process.env.EMAIL_ADDRESS
        },
        to: process.env.EMAIL_ADDRESS_TO,
        replyTo: epost,
        subject: 'Bestilling av rom for Namsos Athenæum',
        text: text_string,
        html: html_string
      }
    }
  }

  if (sjekk === false) {
    const logData = `${new Date().toISOString()} - Navn: ${navn}, Epost: ${epost}, Telefon: ${tlf}, Dato: ${dato}, Lokaler: ${lokaler}, Formål: ${tekst}, Message: ${message}\n`;
    const logPath = path.join(__dirname, 'logs', 'form-submissions-error.txt');

    fs.mkdir(path.dirname(logPath), { recursive: true })
      .then(() => fs.appendFile(logPath, logData))
      .catch(err => console.error('Error writing to log file:', err));

    res.render('pages/tilbakemelding', {
      sjekk: sjekk,
      message: message
    });
  } else {
    if (process.env.NODE_ENV === 'production') {
      transporter.verify(function (error, success) {
        if (error) {
          console.log(error);
        } else {
          const logData = `${new Date().toISOString()} - Navn: ${navn}, Epost: ${epost}, Telefon: ${tlf}, Dato: ${dato}, Lokaler: ${lokaler}, Formål: ${tekst}\n`;
          const logPath = path.join(__dirname, 'logs', 'form-submissions-success.txt');

          fs.mkdir(path.dirname(logPath), { recursive: true })
            .then(() => fs.appendFile(logPath, logData))
            .catch(err => console.error('Error writing to log file:', err));

          transporter.sendMail(mailOptions, function (err, result) {
            if (err) {
              res.render('pages/tilbakemelding', {
                sjekk: sjekk,
                message: err
              });
            } else {
              transporter.close();
              res.render('pages/tilbakemelding', { sjekk: sjekk, message: message });
            }
          });
        }
      });
    } else if (process.env.NODE_ENV === 'development') {
      console.log(mailOptions);

      const logData = `${new Date().toISOString()} - Navn: ${navn}, Epost: ${epost}, Telefon: ${tlf}, Dato: ${dato}, Lokaler: ${lokaler}, Formål: ${tekst}\n`;
      const logPath = path.join(__dirname, 'logs', 'form-submissions.txt');

      fs.mkdir(path.dirname(logPath), { recursive: true })
        .then(() => fs.appendFile(logPath, logData))
        .catch(err => console.error('Error writing to log file:', err));

      res.render('pages/tilbakemelding', { sjekk: sjekk, message: message });
    } else {
      console.warn(`Unknown environment when POST /skjema: ${process.env.NODE_ENV}`);
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`App listening at http://localhost:${PORT}`)
})