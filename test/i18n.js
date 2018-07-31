const I18n = require('../lib/i18n')
const lang = new I18n()

setTimeout(() => {
  console.log(lang.string("en-US", "bot_admin_given_execs", "100", "500"))
}, 500)