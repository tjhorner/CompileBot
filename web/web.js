const express = require('express')
const { Execution } = require('./db')
const app = express()

app.set("view engine", "ejs")
app.use(express.static("public"))

app.get("/", (req, res) => {
  res.redirect("https://t.me/CompileBot")
})

app.get("/execution/:id", (req, res) => {
  Execution.findById(req.params.id).populate("user").exec((err, execution) => {
    if(err) {
      res.render("404")
    } else {
      res.render("execution", { execution })
    }
  })
})

app.listen(3000)