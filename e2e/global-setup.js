import http from 'node:http';

function checkUrl(url, retries = 15, delay = 2000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function attempt() {
      attempts++;
      http.get(url, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve();
        } else if (attempts < retries) {
          setTimeout(attempt, delay);
        } else {
          reject(new Error(`${url} returned ${res.statusCode} after ${retries} attempts`));
        }
      }).on('error', () => {
        if (attempts < retries) {
          setTimeout(attempt, delay);
        } else {
          reject(new Error(`${url} unreachable after ${retries} attempts`));
        }
      });
    }
    attempt();
  });
}

export default async function globalSetup() {
  console.log('Checking frontend at http://localhost:5173...');
  await checkUrl('http://localhost:5173');
  console.log('Frontend is up.');

  console.log('Checking backend at http://localhost:4000/api/health...');
  await checkUrl('http://localhost:4000/api/health');
  console.log('Backend is up.');
}
