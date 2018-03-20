'use strict'

function parsePayload (payload) {
  if (payload instanceof Buffer) {
    payload = payload.toString('utf8')
  }
  try {
    console.log('ahi va el payload')
    console.log(payload)
    payload = JSON.parse(payload)
  } catch (e) {
    payload = null
  }
  return payload
}

module.exports = {
  parsePayload
}
