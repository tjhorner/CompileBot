const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

class I18n {
  constructor() {
    // This will be used as a fallback if the language is not found
    this.defaultLanguage = "en-US"
    this.languages = { }

    // Load languages
    fs.readFile(path.join(__dirname, "lang", "languages.json"), (err, data) => {
      const languages = JSON.parse(data)

      for(const code in languages) {
        const lang = languages[code]
        
        fs.readFile(path.join(__dirname, "lang", `${code}.yml`), (err, langStrings) => {
          const strings = yaml.safeLoad(langStrings)

          this.languages[code] = {
            name: lang.name,
            flag: lang.flag,
            strings
          }
        })
      }
    })
  }

  string(language, key, ...values) {
    if(this.languages[language])
      var lang = this.languages[language]
    else
      var lang = this.languages[this.defaultLanguage]

    var string = lang.strings[key]
    var renderedString = string.concat() // hacky
    for(var i = 0; i < string.match(/%s/g).length; i++) {
      renderedString = renderedString.replace(/%s/, values[i])
    }

    return renderedString
  }
}

module.exports = I18n