require("./settings");
const pino = require("pino");
const fs = require("fs");
const chalk = require("chalk");
const FileType = require("file-type");
const PhoneNumber = require("awesome-phonenumber");
const {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
} = require("./lib/exif");
const { smsg, getBuffer } = require("./lib/myfunc");
const {
  default: WaCrasherConnect,
  delay,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  downloadContentFromMessage,
  makeInMemoryStore,
  jidDecode,
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const Pino = require("pino");
const readline = require("readline");
const makeWASocket = require("@whiskeysockets/baileys").default;

const store = makeInMemoryStore({
  logger: pino().child({
    level: "silent",
    stream: "store",
  }),
});
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function StartWaBot() {
  //------------------------------------------------------
  const { state, saveCreds } = await useMultiFileAuthState(`./session`);
  const msgRetryCounterCache = new NodeCache(); // for retry message, "waiting message"
  const CrasherInc = makeWASocket({
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        Pino({ level: "fatal" }).child({ level: "fatal" })
      ),
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    getMessage: async (key) => {
      let jid = jidNormalizedUser(key.remoteJid);
      let msg = await store.loadMessage(jid, key.id);

      return msg?.message || "";
    },
    msgRetryCounterCache,
    defaultQueryTimeoutMs: undefined,
  });

  store.bind(CrasherInc.ev);
  CrasherInc.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message) return;
      mek.message =
        Object.keys(mek.message)[0] === "ephemeralMessage"
          ? mek.message.ephemeralMessage.message
          : mek.message;
      if (mek.key && mek.key.remoteJid === "status@broadcast")
        if (
          !CrasherInc.public &&
          !mek.key.fromMe &&
          chatUpdate.type === "notify"
        )
          return;
      if (mek.key.id.startsWith("BAE5") && mek.key.id.length === 16) return;
      const m = smsg(CrasherInc, mek, store);
      require("./XeonBug5")(CrasherInc, m, chatUpdate, store);
    } catch (err) {
      console.log(err);
    }
  });
  CrasherInc.ev.on("messages.upsert", async (chatUpdate) => {
    if (global.autoswview) {
      mek = chatUpdate.messages[0];
      if (mek.key && mek.key.remoteJid === "status@broadcast") {
        await CrasherInc.readMessages([mek.key]);
      }
    }
  });

  CrasherInc.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (
        (decode.user && decode.server && decode.user + "@" + decode.server) ||
        jid
      );
    } else return jid;
  };

  CrasherInc.ev.on("contacts.update", (update) => {
    for (let contact of update) {
      let id = CrasherInc.decodeJid(contact.id);
      if (store && store.contacts)
        store.contacts[id] = {
          id,
          name: contact.notify,
        };
    }
  });

  CrasherInc.getName = (jid, withoutContact = false) => {
    id = CrasherInc.decodeJid(jid);
    withoutContact = CrasherInc.withoutContact || withoutContact;
    let v;
    if (id.endsWith("@g.us"))
      return new Promise(async (resolve) => {
        v = store.contacts[id] || {};
        if (!(v.name || v.subject)) v = CrasherInc.groupMetadata(id) || {};
        resolve(
          v.name ||
            v.subject ||
            PhoneNumber("+" + id.replace("@s.whatsapp.net", "")).getNumber(
              "international"
            )
        );
      });
    else
      v =
        id === "0@s.whatsapp.net"
          ? {
              id,
              name: "WhatsApp",
            }
          : id === CrasherInc.decodeJid(CrasherInc.user.id)
          ? CrasherInc.user
          : store.contacts[id] || {};
    return (
      (withoutContact ? "" : v.name) ||
      v.subject ||
      v.verifiedName ||
      PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber(
        "international"
      )
    );
  };

  CrasherInc.public = true;

  CrasherInc.serializeM = (m) => smsg(CrasherInc, m, store);

  CrasherInc.ev.on("connection.update", async (s) => {
    const { connection, lastDisconnect } = s;
    if (connection == "open") {
      console.log(chalk.magenta(` `));
      console.log(
        chalk.yellow(
          `🌿Connected to => ` + JSON.stringify(CrasherInc.user, null, 2)
        )
      );
      await delay(1999);
      console.log(
        chalk.yellow(
          `\n\n                  ${chalk.bold.blue(`[ ${botname} ]`)}\n\n`
        )
      );
      console.log(
        chalk.cyan(`< ================================================== >`)
      );
    }
    if (
      connection === "close" &&
      lastDisconnect &&
      lastDisconnect.error &&
      lastDisconnect.error.output.statusCode != 401
    ) {
      StartWaBot();
    }
  });
  CrasherInc.ev.on("creds.update", saveCreds);
  CrasherInc.ev.on("messages.upsert", () => {});

  CrasherInc.sendText = (jid, text, quoted = "", options) =>
    CrasherInc.sendMessage(
      jid,
      {
        text: text,
        ...options,
      },
      {
        quoted,
        ...options,
      }
    );
  CrasherInc.sendTextWithMentions = async (jid, text, quoted, options = {}) =>
    CrasherInc.sendMessage(
      jid,
      {
        text: text,
        mentions: [...text.matchAll(/@(\d{0,16})/g)].map(
          (v) => v[1] + "@s.whatsapp.net"
        ),
        ...options,
      },
      {
        quoted,
      }
    );
  CrasherInc.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
    let buff = Buffer.isBuffer(path)
      ? path
      : /^data:.*?\/.*?;base64,/i.test(path)
      ? Buffer.from(path.split`,`[1], "base64")
      : /^https?:\/\//.test(path)
      ? await await getBuffer(path)
      : fs.existsSync(path)
      ? fs.readFileSync(path)
      : Buffer.alloc(0);
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifImg(buff, options);
    } else {
      buffer = await imageToWebp(buff);
    }

    await CrasherInc.sendMessage(
      jid,
      {
        sticker: {
          url: buffer,
        },
        ...options,
      },
      {
        quoted,
      }
    );
    return buffer;
  };
  CrasherInc.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
    let buff = Buffer.isBuffer(path)
      ? path
      : /^data:.*?\/.*?;base64,/i.test(path)
      ? Buffer.from(path.split`,`[1], "base64")
      : /^https?:\/\//.test(path)
      ? await await getBuffer(path)
      : fs.existsSync(path)
      ? fs.readFileSync(path)
      : Buffer.alloc(0);
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifVid(buff, options);
    } else {
      buffer = await videoToWebp(buff);
    }

    await CrasherInc.sendMessage(
      jid,
      {
        sticker: {
          url: buffer,
        },
        ...options,
      },
      {
        quoted,
      }
    );
    return buffer;
  };
  CrasherInc.downloadAndSaveMediaMessage = async (
    message,
    filename,
    attachExtension = true
  ) => {
    let quoted = message.msg ? message.msg : message;
    let mime = (message.msg || message).mimetype || "";
    let messageType = message.mtype
      ? message.mtype.replace(/Message/gi, "")
      : mime.split("/")[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    let type = await FileType.fromBuffer(buffer);
    trueFileName = attachExtension ? filename + "." + type.ext : filename;
    // save to file
    await fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  CrasherInc.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || "";
    let messageType = message.mtype
      ? message.mtype.replace(/Message/gi, "")
      : mime.split("/")[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    return buffer;
  };
}
return StartWaBot();

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});

process.on("uncaughtException", function (err) {
  let e = String(err);
  if (e.includes("conflict")) return;
  if (e.includes("Socket connection timeout")) return;
  if (e.includes("not-authorized")) return;
  if (e.includes("already-exists")) return;
  if (e.includes("rate-overlimit")) return;
  if (e.includes("Connection Closed")) return;
  if (e.includes("Timed Out")) return;
  if (e.includes("Value not found")) return;
  console.log("Caught exception: ", err);
});
