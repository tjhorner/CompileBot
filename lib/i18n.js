const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

class I18n {
  constructor() {
    // This will be used as a fallback if the language is not found
    this.defaultLanguage = "en-US"
    this.languageInfo = [ ]
    this.languages = [ ]

    // Load languages
    fs.readFile(path.join(__dirname, "lang", "languages.json"), (err, data) => {
      const languages = JSON.parse(data)
      this.languageInfo = languages

      languages.forEach(lang => {
        fs.readFile(path.join(__dirname, "lang", `${lang.code}.yml`), (err, langStrings) => {
          const strings = yaml.safeLoad(langStrings)

          this.languages.push({
            code: lang.code,
            aliases: lang.aliases,
            name: lang.name,
            flag: lang.flag,
            strings
          })
        })
      })
    })
  }

  getLanguage(code) {
    return this.languages.filter(lang => lang.code === code || lang.aliases.indexOf(code) !== -1 || code.indexOf(lang.code.split("-")) === 0)[0] || this.getLanguage(this.defaultLanguage)
  }

  string(language, key, ...values) {
    var lang = this.getLanguage(language)

    var string = lang.strings[key]
    
    // fallback to default language's string if we can't find it here
    if(!string)
      string = this.getLanguage(this.defaultLanguage).strings[key]

    var renderedString = string.concat() // hacky

    var matches = string.match(/%s/g)
    for(var i = 0; i < (matches ? matches.length : 0); i++) {
      renderedString = renderedString.replace(/%s/, values[i])
    }

    return renderedString
  }
}

module.exports = I18n