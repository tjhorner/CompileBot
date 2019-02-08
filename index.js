const config = require('./config.json')
const Stream = require('stream')
const Docker = require('dockerode')
const uuid = require('uuid/v1')
const fs = require('mz/fs')
const path = require('path')
const rimraf = require('rimraf')
const StoreBot = require('./lib/storebot')
const Telegram = require('node-telegram-bot-api')
const { User, Execution } = require('./db')

const I18n = require('./lib/i18n')
const i18n = new I18n()

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
    customCommand: "g++ /usercode/file.c -w -o /output/file.o >/dev/null && chmod +x /output/file.o && /output/file.o"
  },
  {
    name: "C++",
    alias: "cpp",
    file: "file.cpp",
    customCommand: "g++ /usercode/file.cpp -w -o /output/file.o >/dev/null && chmod +x /output/file.o && /output/file.o"
  },
  {
    name: "Java",
    alias: "java",
    file: "file.java",
    customCommand: "javac -g:none -nowarn -d /output /usercode/file.java >/dev/null && chmod -R +x /output && runjava"
  },
  {
    name: "JavaScript (Node.js)",
    alias: "node",
    executable: "nodejs", // NEW: node
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
  // {
  //   name: "C#",
  //   alias: "csharp",
  //   file: "file.cs",
  //   customCommand: "gmcs /usercode/file.cs -out:/output/file.exe >/dev/null && mono /output/file.exe"
  // },
  // {
  //   name: "Visual Basic .NET",
  //   alias: "vb",
  //   file: "file.vb",
  //   customCommand: "vbnc /quiet /nologo /out:/output/file.exe /usercode/file.vb >/dev/null && mono /output/file.exe"
  // },
  {
    name: "Ruby",
    alias: "ruby",
    executable: "ruby",
    file: "file.rb"
  },
  {
    name: "PHP 7",
    alias: "php7",
    executable: "php7",
    file: "file.php",
    sourcePrefix: "<?php "
  },
  // {
  //   name: "Lua 5.0",
  //   alias: "lua50",
  //   executable: "lua50",
  //   file: "file.lua"
  // },
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
  },
  {
    name: "Go",
    alias: "golang",
    customCommand: "go run /usercode/main.go",
    file: "main.go"
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

// TODO: use telegraf+middleware instead
function getString(user, key, ...values) {
  return i18n.string(user.languageCode, key, ...values)
}

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
            username: telegramUser.username,
            languageCode: telegramUser.language_code
          }).then(user => resolve(user))
          
          telegram.sendMessage(78442301, `*New user:* [${telegramUser.id}](tg://user?id=${telegramUser.id})`, {
            parse_mode: "Markdown"
          })
        } else {
          var user = users[0]

          if(user.firstName !== telegramUser.first_name || user.lastName !== telegramUser.last_name || user.username !== telegramUser.username || !user.languageCode) {
            user.firstName = telegramUser.first_name
            user.lastName = telegramUser.last_name
            user.username = telegramUser.username
            if(!user.languageCode) user.languageCode = telegramUser.language_code

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
          User: "compilebot",
          NetworkDisabled: true,
          HostConfig: {
            Memory: 67108864, // 64 MB
            MemorySwap: 67108864, // also 64 MB, disallow swap
            PidsLimit: 100, // 100 processes - prevent fork bombing
            Binds: [ `${tempDirExt}:/usercode` ],
            Runtime: "runsc"
          },
          Env: [ "NODE_PATH=/usr/local/lib/node_modules" ],
          Name: sandboxId
        }, (err, data, container) => {
          if(!didTimeout) {
            clearTimeout(executionTimeout)
            if(err) reject(err)
            if(!err) resolve(stdout)
            if(container) container.remove()
          }

          rimraf(tempDir, (err) => { })
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

      var msgText = `<i>${getString(user, "running_code")}</i>\n\n<b>${getString(user, "language")}</b>\n${lang.name}\n\n<b>${getString(user, "input")}</b>\n<pre>${escapeHTML(code)}</pre>\n\n<b>${getString(user, "output")}</b>\n<pre>${escapeHTML(currentStdout)}</pre>`

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

        telegram.editMessageText(`_${getString(user, "too_long_live")}_`, editParams)
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
  }).then(sandboxResult => {
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

        telegram.sendMessage(78442301, `New exec: https://compilebot.horner.tj/execution/${execution._id}`)

        var msgText = `<b>${getString(user, "language")}</b>\n${lang.name}\n\n<b>${getString(user, "input")}</b>\n<pre>${escapeHTML(code)}</pre>\n\n<b>${getString(user, "output")}</b>\n<pre>${escapeHTML(sandboxResult)}</pre>`
        if(msgText.length > 4096) {
          var editParams = {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: getString(user, "view_full"),
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
                    text: getString(user, "view_full"),
                    url: `https://compilebot.horner.tj/execution/${execution._id}`
                  }
                ],
                [
                  {
                    text: getString(user, "share_output"),
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

        var msgText = `_${getString(user, "too_long_to_run")}_`
      } else {
        console.log("Uh oh", err)
        var msgText = `_${getString(user, "internal_error")}_\n_${getString(user, "did_not_count")}_`
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
                messageText += `<b>${getString(user, "author")}</b>\n<a href="tg://user?id=${exec.user.telegramId}">${escapeHTML(exec.user.firstName)}</a>\n\n`

              messageText += `<b>${getString(user, "language")}</b>\n${exec.language}\n\n<b>${getString(user, "input")}</b>\n<pre>${escapeHTML(exec.input)}</pre>\n\n<b>${getString(user, "output")}</b>\n<pre>${escapeHTML(exec.output)}</pre>`

              telegram.answerInlineQuery(query.id, [
                {
                  type: "article",
                  id: "share",
                  title: getString(user, "share_execution", exec.language),
                  description: getString(user, "share_execution_long", exec.language),
                  input_message_content: {
                    message_text: messageText,
                    parse_mode: "HTML"
                  },
                  reply_markup: {
                    inline_keyboard: [
                      [
                        {
                          text: getString(user, "view_full"),
                          url: `https://compilebot.horner.tj/execution/${exec._id}`
                        }
                      ],
                      [
                        {
                          text: getString(user, "share_output"),
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
              switch_pm_text: getString(user, "type_some_code"),
              cache_time: 10,
              is_personal: true
            })
          } else {
            var result = languages.map(lang => {
              return {
                type: "article",
                id: lang.alias,
                title: lang.name,
                description: getString(user, "run_as", lang.name),
                input_message_content: {
                  message_text: `_${getString(user, "running_code_as", lang.name)}_`,
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
            switch_pm_text: getString(user, "no_execs_left"),
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
          var msgText = `_${getString(user, "out_of_execs")}_`
          telegram.editMessageText(msgText, {
            inline_message_id: result.inline_message_id,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: getString(user, "get_more_execs"),
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
        telegram.sendMessage(msg.from.id, getString(user, "added_execs", execAmount), {
          parse_mode: "Markdown"
        })
      })
    })
})

telegram.on("callback_query", query => {
  findOrCreateUser(query.from)
    .then(user => {
      if(query.data.split(":")[0] === "LANG") {
        var lang = i18n.getLanguage(query.data.split(":")[1])
        
        if(lang) {
          user.languageCode = lang.code
          user.save()

          telegram.sendMessage(user.telegramId, i18n.string(lang.code, "changed_language"), { parse_mode: "Markdown" })
          telegram.answerCallbackQuery(query.id)
        }
      } else if(user.executions > 0) {
        var lang = languages.filter(lang => lang.alias === query.data.split(":")[1])[0]
        var session = sessions[query.from.id.toString()]

        if(session.code && session.compileMessageId) {
          telegram.editMessageText(`_${getString(user, "running_code_as", lang.name)}_`, {
            chat_id: query.from.id,
            message_id: session.compileMessageId,
            parse_mode: "Markdown"
          })

          runCode(lang, session.code, user, session.compileMessageId, null)
        } else {
          telegram.editMessageText(`_${getString(user, "session_expired")}_`, {
            chat_id: query.from.id,
            message_id: session.compileMessageId,
            parse_mode: "Markdown"
          })
        }
      } else {
        telegram.editMessageText(`_${getString(user, "out_of_execs")}_`, {
          chat_id: query.from.id,
          message_id: session.compileMessageId,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: getString(user, "get_more_execs"),
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
    .then(user => {
      var welcomeText = `${getString(user, "welcome_one")}\n\n${getString(user, "welcome_two")}\n\n`

      languages.forEach(lang => {
        welcomeText += `- ${lang.name}\n`
      })
    
      welcomeText += `\n${getString(user, "welcome_three")}\n\n${getString(user, "welcome_four")}`
    
      telegram.sendMessage(msg.from.id, welcomeText, { parse_mode: "Markdown" })
    })
}

// COMMAND /start (without params)
telegram.onText(/^\/start$/, sendStartMessage)

// COMMAND /start (with params)
telegram.onText(/^\/start (.+)/, (msg, matches) => {
  findOrCreateUser(msg.from)
    .then(user => {
      switch(matches[1]) {
        case "getexecs":
          telegram.sendMessage(msg.from.id, `${getString(user, "get_more")}\n\n/exec1000 — *1000 executions* for $5.00 ($0.005/exec)\n/exec100 — *100 executions* for $1.00 ($0.01/exec)`, {
            parse_mode: "Markdown"
          })
          break
        default:
          sendStartMessage(msg)
          break
      }
    })
})

// COMMAND /inline
telegram.onText(/^\/inline$/, msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      telegram.sendMessage(msg.from.id, getString(user, "inline_demo"), { parse_mode: "Markdown" })
        .then(newMsg => {
          telegram.sendDocument(msg.from.id, "CgADAQADBAAD-tPQTfXrMu4ndMa5Ag", {
            reply_to_message_id: newMsg.message_id
          })
        })
    })
})

// COMMAND /compile (without params)
telegram.onText(/^\/compile$/, msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      telegram.sendMessage(msg.from.id, getString(user, "compile_help"), {
        parse_mode: "Markdown"
      })
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

        telegram.sendMessage(msg.from.id, getString(user, "which_lang"), {
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: languagesKeyboard
          }
        }).then(botMsg => {
          session.compileMessageId = botMsg.message_id
        })
      } else {
        telegram.sendMessage(msg.from.id, getString(user, "use_getexecutions"))
      }
    })
})

telegram.onText(/^\/getexecutions$/, msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      var message = `*${getString(user, "need_more_execs")}* `

      if(!user.redeemedFreeExecutions)
        message += getString(user, "free_execs")
      else
        message += getString(user, "no_free_execs")

      message += `\n\n/exec1000 — *1000 executions* ${getString(user, "for")} $5.00 ($0.005/exec)\n/exec100 — *100 executions* ${getString(user, "for")} $1.00 ($0.01/exec)\n\n${getString(user, "current_execs", user.executions)}`

      telegram.sendMessage(msg.from.id, message, {
        parse_mode: "Markdown"
      })
    })
})

telegram.onText(/^\/help$/, msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      User.count()
        .then(userCount => {
          telegram.sendMessage(msg.from.id, getString(user, "faq", userCount), {
            disable_web_page_preview: true,
            parse_mode: "Markdown"
          })
        })
    })
})

telegram.onText(/^\/exec100$/, msg => {
  telegram.sendInvoice(msg.from.id, "100 Executions", getString(user, "execs_invoice_desc", "100", "$0.01"), "exec100", debugMode ? config.stripeTestToken : config.stripeLiveToken, "buy100", "USD", [
    {
      label: "100 Executions",
      amount: 100
    }
  ])
})

telegram.onText(/^\/exec1000$/, msg => {
  telegram.sendInvoice(msg.from.id, "1000 Executions", getString(user, "execs_invoice_desc", "1000", "$0.05"), "exec1000", debugMode ? config.stripeTestToken : config.stripeLiveToken, "buy1000", "USD", [
    {
      label: "1000 Executions",
      amount: 500
    }
  ])
})

telegram.onText(/^\/redeemexecs$/, msg => {
  findOrCreateUser(msg.from)
    .then(user => {
      if(user.redeemedFreeExecutions) {
        telegram.sendMessage(msg.from.id, getString())
      } else {
        StoreBot.getReviews("compilebot", 0, 20)
          .then(reviews => {
            var review = reviews.filter(rev => rev.userId === msg.from.id.toString())[0]

            if(review) {
              user.redeemedFreeExecutions = true
              user.executions += 100
              user.save().then(() => {
                telegram.sendMessage(msg.from.id, getString(user, "thanks_for_reviewing"), { parse_mode: "Markdown" })
              })
            } else {
              telegram.sendMessage(msg.from.id, getString(user, "redeem_instructions"), { parse_mode: "Markdown" })
            }
          })
      }
    })
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

            telegram.sendMessage(toUserId, getString(user, "bot_admin_given_execs", execsToGive, user.executions), {
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

telegram.onText(/^\/optout$/, (msg, matches) => {
  findOrCreateUser(msg.from)
    .then(user => {
      user.optOutBroadcasts = true
      user.save()

      console.log(user.telegramId, "opted out")
      telegram.sendMessage(msg.from.id, "You've successfully opted out of announcements. If you change your mind, use /optin.")
    })
})

telegram.onText(/^\/optin$/, (msg, matches) => {
  findOrCreateUser(msg.from)
    .then(user => {
      user.optOutBroadcasts = false
      user.save()

      telegram.sendMessage(msg.from.id, "You've successfully opted back into announcements. If you change your mind, use /optout.")
    })
})

telegram.onText(/^\/lang$/, (msg, matches) => {
  findOrCreateUser(msg.from)
    .then(user => {
      telegram.sendMessage(msg.from.id, getString(user, "choose_new_lang"), {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: i18n.languageInfo.map(language => [
            {
              text: `${language.flag} ${language.name}`,
              callback_data: `LANG:${language.code}`
            }
          ])
        }
      })
    })
})

// telegram.onText(/^\/announce$/, (msg, matches) => {
//   if(config.admins.indexOf(msg.from.id.toString()) !== -1) {
//     User.find()
//       .then(users => {
//         users.forEach((user, index) => {
//           setTimeout(() => {
//             var message =
// `Hello! I've got a few announcements for you:

// *CompileBot has gone international!*
// Multiple language support has been added internally, but we only have English for now. If you are fluent in English and another language you'd like to see CompileBot support, please let @bcrypt know. For your time, you'll be given *10000* free executions _(which should probably set you for life...)_

// *The execution webpage has been redesigned!*
// The page now has a full dark theme and generally looks a lot nicer. If you want to check it out, [here](https://compilebot.horner.tj/execution/5b60cf20c22fad72fa66e4e1) is a good execution to try it with.

// That's all for now. If you want to opt-out of these (very) infrequent announcements, you can send /optout.`
                  
//             telegram.sendMessage(user.telegramId, message, { parse_mode: "Markdown" })
//               .then(sentMsg => {
//                 console.log("sent message", user.telegramId)
//                 telegram.sendPhoto(user.telegramId, "AgADAQADrqcxGy27CE8vB38U-JmUVYcSCzAABM6WpcfSqJifK3MAAgI", {
//                   caption: "Here's what the new page design looks like.",
//                   reply_to_message_id: sentMsg.message_id
//                 })
//               })
//               .catch(err => {
//                 console.log("cannot send message", user.telegramId, err)
//               })
//           }, index * 100)
//         })
//       })
//   }
// })

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