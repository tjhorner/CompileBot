const request = require('request')
const API_BASE = "https://storebot.me/api/"

class StoreBot {
  static _get(endpoint, qs) {
    return new Promise((resolve, reject) => {
      request(`${API_BASE}${endpoint}`, { qs, json: true }, (err, res, body) => {
        if(err) reject(err)
        if(!err) resolve(body)
      })
    })
  }
  
  static getReviews(username, offset = 0, count = 10) {
    return this._get("bots/reviews", { id: username, offset, count })
  }
}

module.exports = StoreBot