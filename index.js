const config = require('./config.json')
const Stream = require('stream')
const Docker = require('dockerode')
const uuid = require('uuid/v1')
const fs = require('mz/fs')
const path = require('path')
const rimraf = require('rimraf')
const detectLanguage = require('language-detect')
const Telegram = require('node-telegram-bot-api')
const { User, Execution } = require('./db')

const debugMode = process.env.PRODUCTION ? false : true

const telegram = new Telegram(config.token, { polling: true })

const tempRoot = process.env.BOT_ROOT ? path.join(process.env.BOT_ROOT, "temp") : path.join(__dirname, "temp")

const languages = [
  {
    name: "C",
    alias: "c",
    file: "file.c",
    customCommand: "g++ /usercode/file.c -w -o /output/file.o >/dev/null && /output/file.o"
  },
  {
    name: "C++",
    alias: "cpp",
    file: "file.cpp",
    customCommand: "g++ /usercode/file.cpp -w -o /output/file.o >/dev/null && /output/file.o"
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
    name: "Lua",
    alias: "lua",
    executable: "lua",
    file: "file.lua"
  },
  {
    name: "C#",
    alias: "csharp",
    file: "file.cs",
    customCommand: "gmcs /usercode/file.cs -out:/output/file.exe >/dev/null && mono /output/file.exe"
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
  return str.replace(/\&/gi, "&amp;").replace(/\</gi, "&lt;").replace(/\>/gi, "&gt;")
}

function findOrCreateUser(telegramUser) {
  return new Promise((resolve, reject) => {
    User.find({ telegramId: telegramUser.id })
      .then(users => {
        if(users.length === 0) {
          User.create({
            telegramId: telegramUser.id,
            firstName: telegramUser.first_name,
            lastName: telegramUser.last_name,
            username: telegramUser.username
          }).then(user => resolve(user))
        } else {
          var user = users[0]

          if(user.firstName !== telegramUser.first_name || user.lastName !== telegramUser.last_name || user.username !== telegramUser.username) {
            user.firstName = telegramUser.first_name
            user.lastName = telegramUser.last_name
            user.username = telegramUser.username

            user.save().then(user => resolve(user))
          } else resolve(user)
        }
      })
      .catch(reject)
  })
}

function runSandbox(language, source) {
  return new Promise((resolve, reject) => {
    var sandboxId = `${language.alias}_${uuid()}`
    var tempDir = path.join(__dirname, "temp", sandboxId)
    var tempDirExt = path.join(tempRoot, sandboxId)

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

        var executionTimeout
        var didTimeout = false

        var runner = docker.run("tjhorner/compilebot_sandbox:latest", [ "bash", "-c", command ], stream, {
          Tty: true,
          Interactive: true,
          User: "mysql",
          Hostconfig: {
            Binds: [ `${tempDirExt}:/usercode` ]
          },
          Env: [ "NODE_PATH=/usr/local/lib/node_modules" ],
          Name: sandboxId
        }, (err, data, container) => {
          if(!didTimeout) {
            clearTimeout(executionTimeout)
            if(err) reject(err)
            if(!err) resolve(stdout)
            rimraf(tempDir, (err) => { })
            if(container) container.remove()
          }
        })

        runner.on("container", container => {
          executionTimeout = setTimeout(() => {
            didTimeout = true
            container.kill().then(() => container.remove())
            reject("timeout")
          }, 20000)
        })
      })
  })
}

telegram.on("inline_query", query => {
  findOrCreateUser(query.from)
    .then(user => {
      if(user.executions > 0) {
        var result = languages.map(lang => {
          return {
            type: "article",
            id: lang.alias,
            title: lang.name,
            description: `Compile this code as ${lang.name}`,
            input_message_content: {
              message_text: `_Just a sec, compiling this ${lang.name} code..._`,
              parse_mode: "Markdown"
            },
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Telegram made me put a button here",
                    url: "https://telegram.org"
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
          switch_pm_parameter: "getexecs",
          switch_pm_text: "No executions left! Select to get more.",
          cache_time: 10,
          is_personal: true
        })
      }
    })
})

telegram.on("chosen_inline_result", result => {
  findOrCreateUser(result.from)
    .then(user => {
      if(user.executions > 0) {
        var lang = languages.filter(lang => lang.alias === result.result_id)[0]
    
        runSandbox(lang, result.query)
          .then(sandboxResult => {
            Execution.create({
              user: user._id,
              language: lang.name,
              input: result.query.trim(),
              output: sandboxResult.trim()
            }, (err, execution) => {
              user.executions--
              user.save()

              var msgText = `<b>Language</b>\n${lang.name}\n\n<b>Input</b>\n<pre>${escapeHTML(result.query)}</pre>\n\n<b>Output</b>\n<pre>${escapeHTML(sandboxResult.trim())}</pre>`
              if(msgText.length > 4096) {
                telegram.editMessageText("_The output is too long to display here. Use the button below to view the execution._", {
                  inline_message_id: result.inline_message_id,
                  parse_mode: "Markdown",
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "View full output",
                          url: `https://compilebot.horner.tj/execution/${execution._id}`
                        }
                      ]
                    ]
                  }
                })
              } else {
                telegram.editMessageText(msgText, {
                  inline_message_id: result.inline_message_id,
                  parse_mode: "HTML",
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "View full output",
                          url: `https://compilebot.horner.tj/execution/${execution._id}`
                        }
                      ]
                    ]
                  }
                })
              }
            })
          })
          .catch(err => {
            if(err === "timeout") {
              user.executions--
              user.save()

              var msgText = "_This code took too long to run, so its execution was terminated._"
              telegram.editMessageText(msgText, {
                inline_message_id: result.inline_message_id,
                parse_mode: "Markdown"
              })
            } else {
              console.log("Uh oh", err)
              var msgText = "_There was an internal error compiling this code :(_\n_(This did not count toward your executions.)_"
              telegram.editMessageText(msgText, {
                inline_message_id: result.inline_message_id,
                parse_mode: "Markdown"
              })
            }
          })
      } else {
        var msgText = "_Out of executions! Get more with the button below._"
        telegram.editMessageText(msgText, {
          inline_message_id: result.inline_message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Get more executions",
                  url: "https://t.me/CompileBot?start=getexecs"
                }
              ]
            ]
          }
        })
      }
    })
})

telegram.on("pre_checkout_query", query => {
  if(query.invoice_payload === "exec100" || query.invoice_payload === "exec1000") {
    telegram.answerPreCheckoutQuery(query.id, true)
  } else {
    telegram.answerPreCheckoutQuery(query.id, false, {
      error_message: "Sorry, this option is invalid."
    })
  }
})

telegram.on("successful_payment", msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      var payment = msg.successful_payment

      switch(payment.invoice_payload) {
        case "exec100":
          var execAmount = 100
          break
        case "exec1000":
          var execAmount = 1000
          break
      }

      user.executions += execAmount
      user.save().then(() => {
        telegram.sendMessage(msg.from.id, `I have added *${execAmount}* code executions to your account. Thank you for your purchase :)`, {
          parse_mode: "Markdown"
        })
      })
    })
})

function sendStartMessage(msg) {
  findOrCreateUser(msg.from)

  var welcomeText = "Hello! I am *Compile Bot*. You can give me pieces of code to compile/run, and I'll give you back the output.\n\nI currently support these languages:\n\n"

  languages.forEach(lang => {
    welcomeText += `- ${lang.name}\n`
  })

  welcomeText += "\nYou can use me with inline mode to easily share snippets and their results with friends. To do so, simply type `@CompileBot` into your message box, then a space, then your code. Choose the language you want and I'll compile it! Want a demo? Send /inline."

  telegram.sendMessage(msg.from.id, welcomeText, { parse_mode: "Markdown" })
}

// COMMAND /start (without params)
telegram.onText(/^\/start$/, sendStartMessage)

// COMMAND /start (with params)
telegram.onText(/^\/start (.+)/, (msg, matches) => {
  switch(matches[1]) {
    case "getexecs":
      telegram.sendMessage(msg.from.id, `*You're out of executions!* You can get some more here:\n\n/exec1000 — *1000 executions* for $5.00 ($0.005/exec)\n/exec100 — *100 executions* for $1.00 ($0.01/exec)`, {
        parse_mode: "Markdown"
      })
      break
    default:
      sendStartMessage(msg)
      break
  }
})

// COMMAND /inline
telegram.onText(/^\/inline$/, msg => {
  telegram.sendMessage(msg.from.id, "To compile code with inline mode, simply type `@CompileBot` into your message box, a space, then your code. Here is a demo:", { parse_mode: "Markdown" })
    .then(newMsg => {
      telegram.sendDocument(msg.from.id, "CgADAQADBAAD-tPQTfXrMu4ndMa5Ag", {
        reply_to_message_id: newMsg.message_id
      })
    })
})

telegram.onText(/^\/getexecutions$/, msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      telegram.sendMessage(msg.from.id, `*Need more code executions?* You can get some more here:\n\n/exec1000 — *1000 executions* for $5.00 ($0.005/exec)\n/exec100 — *100 executions* for $1.00 ($0.01/exec)\n\nYou currently have *${user.executions}* executions left.`, {
        parse_mode: "Markdown"
      })
    })
})

telegram.onText(/^\/support$/, msg => {
  telegram.sendMessage(msg.from.id, `If something is wrong with the bot or you have a suggestion for it, please contact @bcrypt.`)
})

telegram.onText(/^\/exec100$/, msg => {
  telegram.sendInvoice(msg.from.id, "100 Executions", "100 code executions priced at $0.01 per execution.", "exec100", debugMode ? config.stripeTestToken : config.stripeLiveToken, "buy100", "USD", [
    {
      label: "100 Executions",
      amount: 100
    }
  ])
})

telegram.onText(/^\/exec1000$/, msg => {
  telegram.sendInvoice(msg.from.id, "1000 Executions", "1000 code executions priced at $0.005 per execution.", "exec1000", debugMode ? config.stripeTestToken : config.stripeLiveToken, "buy1000", "USD", [
    {
      label: "1000 Executions",
      amount: 500
    }
  ])
})

// COMMAND /give
telegram.onText(/^\/give (.+)$/, (msg, matches) => {
  if(config.admins.indexOf(msg.from.id.toString()) !== -1) {
    var split = matches[1].split(" ")
    var toUserId = parseInt(split[0])
    var execsToGive = parseInt(split[1])

    console.log(split)
    console.log("/give", toUserId, execsToGive)

    User.find({ telegramId: toUserId })
      .then(users => {
        if(users.length > 0) {
          var user = users[0]

          user.executions += execsToGive
          user.save().then(() => {
            telegram.sendMessage(msg.from.id, `Given ${execsToGive} execs to [${toUserId}](tg://user?id=${toUserId}), they now have ${user.executions}.`, {
              parse_mode: "Markdown"
            })

            telegram.sendMessage(toUserId, `*A bot admin has given you ${execsToGive} free executions!* How generous of them. You now have ${user.executions} executions.`, {
              parse_mode: "Markdown"
            })
          })
        } else {
          telegram.sendMessage(msg.from.id, "User doesn't exist.")
        }
      })
      .catch(err => {
        console.log("/give", err)
        telegram.sendMessage(msg.from.id, "Couldn't give execs, check log for more info.")
      })
  }
})

if(debugMode) {
  telegram.onText(/^\/resetexecs$/, msg => {
    findOrCreateUser(msg.from)
      .then(user => {
        user.executions = 0
        user.save()
      })
  })
}