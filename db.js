const mongoose = require('mongoose')
mongoose.connect(process.env.MONGO_URL)

const User = mongoose.model("User", {
  telegramId: {
    type: Number,
    unique: true,
    required: true,
    dropDups: true
  },
  firstName: String,
  lastName: String,
  username: String,
  languageCode: String,
  optOutBroadcasts: {
    type: Boolean,
    default: false
  },
  executions: {
    type: Number,
    default: 50
  },
  redeemedFreeExecutions: {
    type: Boolean,
    default: false
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