const mongoose = require('mongoose')
mongoose.connect(process.env.MONGO_URL)

const User = mongoose.model("User", {
  telegramId: Number,
  firstName: String,
  lastName: String,
  username: String,
  executions: {
    type: Number,
    default: 50
  }
})

const Execution = mongoose.model("Execution", {
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  language: String,
  languageAlias: String,
  input: String,
  output: String
})

module.exports = { User, Execution }