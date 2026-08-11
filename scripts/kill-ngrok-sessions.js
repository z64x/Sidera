// Script to kill all active ngrok sessions via API
const https = require('https');

// You need to get your API key from: https://dashboard.ngrok.com/api
const NGROK_API_KEY = process.env.NGROK_API_KEY || '';

if (!NGROK_API_KEY) {
  console.error('❌ NGROK_API_KEY environment variable not set');
  console.log('Get your API key from: https://dashboard.ngrok.com/api');
  console.log('Then run: set NGROK_API_KEY=your_key && node scripts/kill-ngrok-sessions.js');
  process.exit(1);
}

const options = {
  hostname: 'api.ngrok.com',
  path: '/tunnels',
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${NGROK_API_KEY}`,
    'Ngrok-Version': '2'
  }
};

console.log('🔍 Fetching active ngrok tunnels...');

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('❌ Failed to fetch tunnels:', res.statusCode);
      console.error(data);
      return;
    }

    const response = JSON.parse(data);
    const tunnels = response.tunnels || [];

    if (tunnels.length === 0) {
      console.log('✅ No active tunnels found');
      return;
    }

    console.log(`📋 Found ${tunnels.length} active tunnel(s):`);
    
    tunnels.forEach((tunnel, index) => {
      console.log(`\n${index + 1}. ${tunnel.public_url}`);
      console.log(`   ID: ${tunnel.id}`);
      console.log(`   Forwarding to: ${tunnel.config.addr}`);
      
      // Delete tunnel
      const deleteOptions = {
        hostname: 'api.ngrok.com',
        path: `/tunnels/${tunnel.id}`,
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${NGROK_API_KEY}`,
          'Ngrok-Version': '2'
        }
      };

      const deleteReq = https.request(deleteOptions, (deleteRes) => {
        if (deleteRes.statusCode === 204) {
          console.log(`   ✅ Stopped successfully`);
        } else {
          console.log(`   ❌ Failed to stop (${deleteRes.statusCode})`);
        }
      });

      deleteReq.on('error', (error) => {
        console.error(`   ❌ Error stopping tunnel:`, error.message);
      });

      deleteReq.end();
    });
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
});

req.end();
