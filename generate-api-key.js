// Script per generare API Key sicure
// Uso: node generate-api-key.js

import crypto from 'crypto';

function generateApiKey(tenantName) {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const apiKey = `sk_live_${tenantName}_${randomPart}`;
  return apiKey;
}

// Esempi
console.log('\n🔑 API Keys Generate:\n');
console.log('1. Per CRM SaaS:');
console.log(`   ${generateApiKey('crm')}`);
console.log('\n2. Per E-commerce SaaS:');
console.log(`   ${generateApiKey('ecommerce')}`);
console.log('\n3. Per la tua SaaS:');
console.log(`   ${generateApiKey('mysaas')}`);
console.log('\n⚠️  IMPORTANTE: Salva queste chiavi in modo sicuro!\n');
