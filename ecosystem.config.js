module.exports = {
    apps: [{
        name: 'athenaeum',
        script: 'npm',
        args: 'run start',
        cwd: '/home/zom/www/athenaeum.no',
        env: {
            NODE_ENV: 'production',
            PORT: 3001
        },
        max_memory_restart: '512M',
        restart_delay: 10000,
        autorestart: true,
        max_restarts: 10,
        min_uptime: '10s'
    }]
};