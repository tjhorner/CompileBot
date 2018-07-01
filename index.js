const config = require('./config.json')
const Stream = require('stream')
const Docker = require('dockerode')
const uuid = require('uuid/v1')
const fs = require('mz/fs')
const path = require('path')
const rimraf = require('rimraf')
const detectLanguage = require('language-detect')
const Telegram = require('node-telegram-bot-api')

const telegram = new Telegram(config.token, { polling: true })

const languages = [
  {
    name: "C",
    alias: "c",
    file: "file.c",
    customCommand: "g++ /usercode/file.c -w -o /usercode/file.o >/dev/null && /usercode/file.o"
  },
  {
    name: "C++",
    alias: "cpp",
    file: "file.cpp",
    customCommand: "g++ /usercode/file.cpp -w -o /usercode/file.o >/dev/null && /usercode/file.o"
  },
  {
    name: "Node.js",
    alias: "node",
    executable: "nodejs",
    file: "file.js"
  },
  {
    name: "Python 2",
    alias: "py2",
    executable: "python2",
    file: "file.py"
  },
  {
    name: "Python 3",
    alias: "py3",
    executable: "python3",
    file: "file.py"
  },
  {
    name: "Ruby",
    alias: "ruby",
    executable: "ruby",
    file: "file.rb"
  },
  {
    name: "PHP 5",
    alias: "php",
    executable: "php",
    file: "file.php"
  }
]

var docker = new Docker()

function escapeHTML(str) {
  return str.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}

function runSandbox(language, source) {
  return new Promise((resolve, reject) => {
    var sandboxId = `${language.alias}_${uuid()}`
    var tempDir = path.join(__dirname, "temp", sandboxId)

    fs.mkdir(tempDir)
      .then(() => {
        return fs.writeFile(path.join(tempDir, language.file), source)
      })
      .then(() => {
        var stdout = ""

        var stream = new Stream.Writable({
          write: function(chunk, encoding, next) {
            stdout += chunk.toString()
            next()
          }
        })

        var command = language.customCommand ? language.customCommand : `${language.executable} /usercode/${language.file}`
    
        docker.run("tjhorner/compilebot_sandbox:latest", [ "bash", "-c", command ], stream, {
          Tty: true,
          Interactive: true,
          User: "mysql",
          Hostconfig: {
            Binds: [ `${tempDir}:/usercode` ]
          },
          Env: [ "NODE_PATH=/usr/local/lib/node_modules" ]
        }, (err, data, container) => {
          if(err) reject(err)
          if(!err) resolve(stdout)
          rimraf(tempDir, (err) => { })
          if(container) container.remove()
        })
      })
  })
}

telegram.on("inline_query", query => {
  if(config.admins.indexOf(query.from.id.toString()) !== -1) {
    var result = languages.map(lang => {
      return {
        type: "article",
        id: lang.alias,
        title: lang.name,
        description: `Compile this code as ${lang.name}`,
        input_message_content: {
          message_text: `_Just a sec, compiling this code as ${lang.name}..._`,
          parse_mode: "Markdown"
        },
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Useless Button",
                url: "https://google.com"
              }
            ]
          ]
        }
      }
    })

    telegram.answerInlineQuery(query.id, result, {
      is_personal: true
    })
  } else {
    telegram.answerInlineQuery(query.id, [ ], {
      switch_pm_text: "This bot is only available to whitelisted users for now.",
      switch_pm_parameter: "whitelist",
      is_personal: true
    })
  }
})

telegram.on("chosen_inline_result", result => {
  if(config.admins.indexOf(result.from.id.toString()) !== -1) {
    var lang = languages.filter(lang => lang.alias === result.result_id)[0]

    runSandbox(lang, result.query)
      .then(sandboxResult => {
        var msgText = `<b>Language</b>\n${lang.name}\n\n<b>Input</b>\n<pre>${escapeHTML(result.query)}</pre>\n\n<b>Output</b>\n<pre>${escapeHTML(sandboxResult.trim())}</pre>`
        console.log(msgText)
        telegram.editMessageText(msgText, {
          inline_message_id: result.inline_message_id,
          parse_mode: "HTML"
        })
      })
      .catch(err => {
        console.log("Uh oh", err)
        var msgText = "_There was an error compiling this code :(_"
        telegram.editMessageText(msgText, {
          inline_message_id: result.inline_message_id,
          parse_mode: "Markdown"
        })
      })
  }
})