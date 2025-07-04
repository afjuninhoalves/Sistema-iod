// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sistemacim',
    script: './src/server.js',
    instances: 'max',           // usa todos os núcleos disponíveis
    exec_mode: 'cluster',       // cluster mode
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
