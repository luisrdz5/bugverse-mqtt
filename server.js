'use strict'

// codigo para probar  el alta
/*
mqtt pub -t 'agent/message' -m '{"agent": { "uuid" : "yyx", "name" : "test", "username": "bug", "pid":10, "hostname": "bot"}, "metrics": [{ "type": "memory", "value": "1001"}, {"type": "temp", "value": "33"}]}'

*/

const debug = require('debug')('bugverse:mqtt')
const mosca = require('mosca')
const redis = require('redis')
const chalk = require('chalk')
const db = require('bugverse-db')
// const Sequelize = require('bugverse-db')('sequelize')
const Sequelize = require('sequelize')
const {parsePayload} = require('./utils')

const backend = {
  type: 'redis',
  redis,
  return_buffers: true
}
const settings = {
  port: 1883,
  backend
}
const config = {
  database: process.env.DB_NAME || 'bugverse',
  username: process.env.DB_USER || 'bugv',
  password: process.env.DB_PASS || 'bug',
  host: process.env.DB_HOST || 'localhost',
  dialect: 'postgres',
  logging: s => debug(s),
  operatorsAliases: Sequelize.Op
}

const server = new mosca.Server(settings)
const clients = new Map()

let Agent, Metric

server.on('clientConnected', client => {
  debug(`Client Connected: ${client.id}`)
  clients.set(client.id, null)
})

server.on('published', async (packet, client) => {
  debug(`Received: ${packet.topic}`)
  switch (packet.topic) {
    case 'agent/connected':
    case 'agent/disconnected':
      debug(`[agent/disconnected] Payload: ${packet.payload}`)
      break
    case 'agent/message':
      debug(`[agent/message] Payload: ${packet.payload}`)
      const payload = parsePayload(packet.payload)
      if (payload) {
        payload.agent.connected = true
        let agent
        try {
          agent = await Agent.createOrUpdate(payload.agent)
          debug(`[agent/message] Se ha creado/updateado el Agente}`)
        } catch (e) {
          return handleError(e)
        }
        debug(`Agent ${agent.uuid} saved`)
        // Notify Agent is connected
        if (!clients.get(client.id)) {
          clients.set(client.id, agent)
          server.publish({
            topic: 'agent/connected',
            payload: JSON.stringify({
              agent: {
                uuid: agent.uuid,
                name: agent.name,
                hostname: agent.hostname,
                pid: agent.pid,
                connected: agent.connected
              }
            })
          })
        }
        // Store Metrics
        for (let metric of payload.metrics) {
          let m

          try {
            m = await Metric.create(agent.uuid, metric)
          } catch (e) {
            return handleError(e)
          }

          debug(`Metric ${m.id} saved on agent ${agent.uuid}`)
        }
      }
      break
  }

  debug(`[Published] Payload: ${packet.payload}`)
})

server.on('clientDisconnected', async (client) => {
  debug(`Client Disconnected: ${client.id}`)
  const agent = clients.get(client.id)
  if (agent) {
    agent.connected = false
    try {
      await Agent.createOrUpdate(agent)
    } catch (e) {
      return handleError(e)
    }

    // Delete Agent  from Client List
    clients.delete(client.id)
    server.publish({
      topic: 'agent/disconnected',
      payload: JSON.stringify({
        agent: {
          uuid: agent.uuid
        }
      })
    })

    debug(`Client (${client.id}) Associated to Agent (${agent.uuid}) marked as disconnected`)
  }
})

server.on('ready', async () => {
  const services = await db(config).catch(handleFatalError)

  Agent = services.Agent
  Metric = services.Metric

  console.log(`${chalk.green('[bugverse-mqtt]')} server is running`)
})

server.on('error', handleFatalError)

function handleFatalError (err) {
  console.error(`${chalk.red('[bugverse-mqtt][fatal error]')} ${err.message}`)
  console.error(err.stack)
  process.exit(1)
}
function handleError (err) {
  console.error(`$chalk.red('[bugverse-mqtt][error]') ${err.message}`)
  console.error(err.stack)
}

process.on('uncaughtException', handleFatalError)
process.on('unhandleRejection', handleFatalError)
