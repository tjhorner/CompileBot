const mongoose = require('mongoose')
mongoose.connect(process.env.MONGO_URL)

const Execution = mongoose.model("Execution", {
  language: String,
  input: String,
  output: String
})

module.exports = { Execution }