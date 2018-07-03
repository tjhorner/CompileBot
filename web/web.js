const express = require('express')
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
  php: "php",
  lua50: "lua",
  lua51: "lua",
  lua52: "lua",
  lua53: "lua"
}

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

app.listen(3000)