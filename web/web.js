const express = require('express')
const config = require('./config.json')
const request = require('request')
const bodyParser = require('body-parser')
const { Execution } = require('./db')
const app = express()

app.set("view engine", "ejs")
app.use(express.static("public"))

var aliasMap = {
  c: "cpp",
  cpp: "cpp",
  node: "javascript",
  py2: "python",
  py3: "python",
  csharp: "cs",
  ruby: "ruby",
  php5: "php",
  php7: "php",
  java: "java",
  vb: "vb",
  lua50: "lua",
  lua51: "lua",
  lua52: "lua",
  lua53: "lua"
}

app.use(bodyParser.raw())

app.get("/", (req, res) => {
  res.redirect("https://t.me/CompileBot")
})

app.get("/execution/:id", (req, res) => {
  Execution.findById(req.params.id).populate("user").exec((err, execution) => {
    if(err) {
      res.render("404")
    } else {
      var highlightLang = execution.languageAlias ? aliasMap[execution.languageAlias] : ""
      res.render("execution", { execution, highlightLang })
    }
  })
})

app.post(`/update/${config.token}`, (req, res) => {
  req.pipe(request.post("http://bot:3000/update"))
  res.sendStatus(200)
})

app.listen(3000)