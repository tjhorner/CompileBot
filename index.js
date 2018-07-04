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

// internal web server deps
const express = require('express')
const bodyParser = require('body-parser')
const webServer = express()

const debugMode = process.env.PRODUCTION ? false : true

var telegram

if(debugMode) {
  telegram = new Telegram(config.token, { polling: true })
} else {
  telegram = new Telegram(config.token)
  telegram.setWebHook(`${process.env.WEB_ROOT}/update/${config.token}`)
}

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
    name: "Java",
    alias: "java",
    file: "file.java",
    customCommand: "javac -g:none -nowarn -d /output /usercode/file.java >/dev/null && runjava"
  },
  {
    name: "JavaScript (Node.js)",
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
    name: "C#",
    alias: "csharp",
    file: "file.cs",
    customCommand: "gmcs /usercode/file.cs -out:/output/file.exe >/dev/null && mono /output/file.exe"
  },
  {
    name: "Visual Basic .NET",
    alias: "vb",
    file: "file.vb",
    customCommand: "vbnc /quiet /nologo /out:/output/file.exe /usercode/file.vb >/dev/null && mono /output/file.exe"
  },
  {
    name: "Ruby",
    alias: "ruby",
    executable: "ruby",
    file: "file.rb"
  },
  {
    name: "PHP 5",
    alias: "php5",
    executable: "php5",
    file: "file.php",
    sourcePrefix: "<?php "
  },
  {
    name: "PHP 7",
    alias: "php7",
    executable: "php7.0",
    file: "file.php",
    sourcePrefix: "<?php "
  },
  {
    name: "Lua 5.0",
    alias: "lua50",
    executable: "lua50",
    file: "file.lua"
  },
  {
    name: "Lua 5.1",
    alias: "lua51",
    executable: "lua5.1",
    file: "file.lua"
  },
  {
    name: "Lua 5.2",
    alias: "lua52",
    executable: "lua5.2",
    file: "file.lua"
  },
  {
    name: "Lua 5.3",
    alias: "lua53",
    executable: "lua53",
    file: "file.lua"
  }
]

var languagesKeyboard = (function() {
  var tempKeyboard = [ ]

  var i = 0,
      tempRow = [ ]

  languages.forEach((lang, index) => {
    i++
    
    tempRow.push({
      text: lang.name,
      callback_data: `compile:${lang.alias}`
    })

    if(i === 2) {
      tempKeyboard.push(tempRow)
      tempRow = [ ]
      i = 0
    } else if(index === languages.length - 1) {
      // last in array
      tempKeyboard.push(tempRow)
    }
  })

  return tempKeyboard
})()

var sessions = { }

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

function runSandbox(language, source, onOutput) {
  return new Promise((resolve, reject) => {
    var sandboxId = `${language.alias}_${uuid()}`
    var tempDir = path.join(__dirname, "temp", sandboxId)
    var tempDirExt = path.join(tempRoot, sandboxId)

    if(language.sourcePrefix && source.indexOf(language.sourcePrefix) !== 0)
      source = language.sourcePrefix + source

    fs.mkdir(tempDir)
      .then(() => {
        return fs.writeFile(path.join(tempDir, language.file), source)
      })
      .then(() => {
        var stdout = ""

        var stream = new Stream.Writable({
          write: function(chunk, encoding, next) {
            stdout += chunk.toString()
            if(onOutput) onOutput(chunk.toString())
            next()
          }
        })

        var command = language.customCommand ? language.customCommand : `${language.executable} /usercode/${language.file}`

        var executionTimeout
        var didTimeout = false

        var runner = docker.run("tjhorner/compilebot_sandbox:latest", [ "bash", "-c", command ], stream, {
          Hostname: "compilebot",
          Tty: true,
          Interactive: true,
          User: "mysql",
          NetworkDisabled: true,
          Hostconfig: {
            Memory: 67108864, // 64 MB
            PidsLimit: 100, // 100 processes - prevent fork bombing
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

function runCode(lang, code, user, messageId, inlineMessageId) {
  var currentStdout = ""
  var stdoutChanged = false

  var liveOutputInterval = setInterval(() => {
    if(stdoutChanged) {
      stdoutChanged = false

      var msgText = `<i>Currently running code...</i>\n\n<b>Language</b>\n${lang.name}\n\n<b>Input</b>\n<pre>${escapeHTML(code)}</pre>\n\n<b>Output</b>\n<pre>${escapeHTML(currentStdout)}</pre>`

      if(msgText.length > 4096) {
        var editParams = {
          parse_mode: "Markdown"
        }

        // TODO DRY this code
        if(messageId) {
          editParams.chat_id = user.telegramId
          editParams.message_id = messageId
        } else if(inlineMessageId) {
          editParams.inline_message_id = inlineMessageId
        }

        telegram.editMessageText("_This output is too long to be displayed live. Please wait until execution is complete._", editParams)
        clearInterval(liveOutputInterval)
      } else {
        var editParams = {
          parse_mode: "HTML"
        }

        if(messageId) {
          editParams.chat_id = user.telegramId
          editParams.message_id = messageId
        } else if(inlineMessageId) {
          editParams.inline_message_id = inlineMessageId
        }

        telegram.editMessageText(msgText, editParams)
      }
    }
  }, 1000)

  runSandbox(lang, code, /* onOutput */ data => {
    currentStdout += data
    stdoutChanged = true
  })
    .then(sandboxResult => {
      Execution.create({
        user: user._id,
        language: lang.name,
        languageAlias: lang.alias,
        input: code,
        output: sandboxResult
      }, (err, execution) => {
        clearInterval(liveOutputInterval)
        user.executions--
        user.save()

        var msgText = `<b>Language</b>\n${lang.name}\n\n<b>Input</b>\n<pre>${escapeHTML(code)}</pre>\n\n<b>Output</b>\n<pre>${escapeHTML(sandboxResult)}</pre>`
        if(msgText.length > 4096) {
          var editParams = {
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
          }

          if(messageId) {
            editParams.chat_id = user.telegramId
            editParams.message_id = messageId
          } else if(inlineMessageId) {
            editParams.inline_message_id = inlineMessageId
          }

          telegram.editMessageText("_The output is too long to display here. Use the button below to view the execution._", editParams)
        } else {
          var editParams = {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "View full output",
                    url: `https://compilebot.horner.tj/execution/${execution._id}`
                  }
                ],
                [
                  {
                    text: "Share output",
                    switch_inline_query: `exec:${execution._id}`
                  }
                ]
              ]
            }
          }

          if(messageId) {
            editParams.chat_id = user.telegramId
            editParams.message_id = messageId
          } else if(inlineMessageId) {
            editParams.inline_message_id = inlineMessageId
          }

          telegram.editMessageText(msgText, editParams)
        }
      })
    })
    .catch(err => {
      if(err === "timeout") {
        user.executions--
        user.save()

        var msgText = "_This code took too long to run, so its execution was terminated._"
      } else {
        console.log("Uh oh", err)
        var msgText = "_There was an internal error compiling this code :(_\n_(This did not count toward your executions.)_"
      }

      var editParams = {
        parse_mode: "Markdown"
      }

      if(messageId) {
        editParams.chat_id = user.telegramId
        editParams.message_id = messageId
      } else if(inlineMessageId) {
        editParams.inline_message_id = inlineMessageId
      }

      telegram.editMessageText(msgText, editParams)
    })
}

// START events

// EVENT inline_query
telegram.on("inline_query", query => {
  findOrCreateUser(query.from)
    .then(user => {
      if(query.query.indexOf("exec:") === 0) {
        var execId = query.query.split(":")[1]

        Execution.findById(execId).populate("user").exec()
          .then(exec => {
            if(exec) {
              var messageText = ""

              if(exec.user.telegramId !== query.from.id)
                messageText += `<b>Author</b>\n<a href="tg://user?id=${exec.user.telegramId}">${escapeHTML(exec.user.firstName)}</a>\n\n`

              messageText += `<b>Language</b>\n${exec.language}\n\n<b>Input</b>\n<pre>${escapeHTML(exec.input)}</pre>\n\n<b>Output</b>\n<pre>${escapeHTML(exec.output)}</pre>`

              telegram.answerInlineQuery(query.id, [
                {
                  type: "article",
                  id: "share",
                  title: `Share ${exec.language} execution`,
                  description: `Share this ${exec.language} execution in the current chat`,
                  input_message_content: {
                    message_text: messageText,
                    parse_mode: "HTML"
                  },
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: "View full output",
                          url: `https://compilebot.horner.tj/execution/${exec._id}`
                        }
                      ],
                      [
                        {
                          text: "Share output",
                          switch_inline_query: `exec:${exec._id}`
                        }
                      ]
                    ]
                  }
                }
              ], {
                is_personal: true,
                cache_time: 120
              })
            } else {
              telegram.answerInlineQuery(query.id, [ ])
            }
          })
          .catch(err => {
            console.log("e bad", err),
            telegram.answerInlineQuery(query.id, [ ])
          })
      } else {
        if(user.executions > 0) {
          if(query.query.trim() === "") {
            telegram.answerInlineQuery(query.id, [ ], {
              switch_pm_parameter: "start",
              switch_pm_text: "Type some code then select a language...",
              cache_time: 10,
              is_personal: true
            })
          } else {
            var result = languages.map(lang => {
              return {
                type: "article",
                id: lang.alias,
                title: lang.name,
                description: `Run this code as ${lang.name}`,
                input_message_content: {
                  message_text: `_Just a sec, running this ${lang.name} code..._`,
                  parse_mode: "Markdown"
                },
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: "¯\\_(ツ)_/¯",
                        url: "https://tjhorner.com"
                      }
                    ]
                  ]
                }
              }
            })
        
            telegram.answerInlineQuery(query.id, result, {
              is_personal: true
            })
          }
        } else {
          telegram.answerInlineQuery(query.id, [ ], {
            switch_pm_parameter: "getexecs",
            switch_pm_text: "No executions left! Select to get more.",
            cache_time: 10,
            is_personal: true
          })
        }
      }
    })
})

// EVENT chosen_inline_result
telegram.on("chosen_inline_result", result => {
  if(result.result_id !== "share") {
    findOrCreateUser(result.from)
      .then(user => {
        if(user.executions > 0) {
          var lang = languages.filter(lang => lang.alias === result.result_id)[0]
          runCode(lang, result.query, user, null, result.inline_message_id)
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
  }
})

// EVENT pre_checkout_query
telegram.on("pre_checkout_query", query => {
  if(query.invoice_payload === "exec100" || query.invoice_payload === "exec1000") {
    telegram.answerPreCheckoutQuery(query.id, true)
  } else {
    telegram.answerPreCheckoutQuery(query.id, false, {
      error_message: "Sorry, this option is invalid."
    })
  }
})

// EVENT successful_payment
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

telegram.on("callback_query", query => {
  findOrCreateUser(query.from)
    .then(user => {
      if(user.executions > 0) {
        var lang = languages.filter(lang => lang.alias === query.data.split(":")[1])[0]
        var session = sessions[query.from.id.toString()]

        if(session.code && session.compileMessageId) {
          telegram.editMessageText(`_Just a sec, running this ${lang.name} code..._`, {
            chat_id: query.from.id,
            message_id: session.compileMessageId,
            parse_mode: "Markdown"
          })

          runCode(lang, session.code, user, session.compileMessageId, null)
        } else {
          telegram.editMessageText(`_Your session has expired, please send the command again._`, {
            chat_id: query.from.id,
            message_id: session.compileMessageId,
            parse_mode: "Markdown"
          })
        }
      } else {
        telegram.editMessageText(`_Out of executions! Get more with the button below._`, {
          chat_id: query.from.id,
          message_id: session.compileMessageId,
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

// END events

// START commands

function sendStartMessage(msg) {
  findOrCreateUser(msg.from)

  var welcomeText = "Hello! I am *Compile Bot*. You can give me pieces of code to compile/run, and I'll give you back the output.\n\nI currently support these languages:\n\n"

  languages.forEach(lang => {
    welcomeText += `- ${lang.name}\n`
  })

  welcomeText += "\nYou can use me with inline mode to easily share snippets and their results with friends. To do so, simply type `@CompileBot` into your message box, then a space, then your code. Choose the language you want and I'll compile it! Want a demo? Send /inline.\n\nYou can also use the /compile command to run larger pieces of code (Telegram has a 512-character limit on inline mode)."

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

// COMMAND /compile (without params)
telegram.onText(/^\/compile$/, msg => {
  telegram.sendMessage(msg.from.id, "To use this command, type `/compile` then your code. For example, `/compile print \"hello\"`. You will be asked which language you want to run it as later.", {
    parse_mode: "Markdown"
  })
})

// COMMAND /compile (with params)
telegram.onText(/^\/compile ((.|\n)+)/, (msg, matches) => {
  findOrCreateUser(msg.from)
    .then(user => {
      if(user.executions > 0) {
        if(sessions[msg.from.id.toString()]) {
          var session = sessions[msg.from.id.toString()]
        } else {
          sessions[msg.from.id.toString()] = { }
          var session = sessions[msg.from.id.toString()]
        }

        session.code = matches[1].trim()

        telegram.sendMessage(msg.from.id, "Which language do you want to run this code as?", {
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: languagesKeyboard
          }
        }).then(botMsg => {
          session.compileMessageId = botMsg.message_id
        })
      } else {
        telegram.sendMessage(msg.from.id, "You are out of code executions! Use /getexecutions to get more.")
      }
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

// COMMAND /stats
telegram.onText(/^\/stats$/, (msg, matches) => {
  if(config.admins.indexOf(msg.from.id.toString()) !== -1) {
    var message = ""
    User.count()
      .then(userCount => {
        message += `*Users*: ${userCount}\n`
        return Execution.count()
      })
      .then(execCount => {
        message += `*Executions*: ${execCount}`
        telegram.sendMessage(msg.from.id, message, { parse_mode: "Markdown" })
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

// END commands

// START web server (for WH updates)

if(!debugMode) {
  webServer.use(bodyParser.json({ extended: true }))

  // this does not need to have any authentication,
  // as it will only be available internally
  webServer.post("/update", (req, res) => {
    telegram.processUpdate(req.body)
    res.sendStatus(200)
  })

  webServer.listen(3000)
}

// END web server