const sgMail = require('@sendgrid/mail');
const { Client } = require('pg');
const AWS = require('aws-sdk');

// Initialize AWS Secrets Manager
const secretsManager = new AWS.SecretsManager();

// Secret names
const DB_SECRET_NAME = "db_credentials";
const SENDGRID_API_KEY_SECRET_NAME = "email_service_credentials";
const DOMAIN_SECRET_NAME = "domain_secret";

// Fetch secret value from AWS Secrets Manager
const getSecretValue = async (secretName) => {
  try {
    const secret = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
    if ('SecretString' in secret) {
      try {
        return JSON.parse(secret.SecretString); // Parse JSON secrets
      } catch {
        return secret.SecretString; // Return plain text for non-JSON secrets
      }
    } else {
      throw new Error(`Secret for ${secretName} is not a string.`);
    }
  } catch (error) {
    console.error(`Error fetching secret ${secretName}:`, error);
    throw error;
  }
};

const updateUserVerificationTimestamp = async (email, dbCredentials) => {
  const client = new Client({
    host: dbCredentials.DB_HOST_NO_PORT, // Matches JSON key DB_HOST
    port: 5432,                  // No need to fetch if it's always 5432
    user: dbCredentials.DB_USERNAME, // Matches JSON key DB_USERNAME
    password: dbCredentials.DB_PASSWORD, // Matches JSON key DB_PASSWORD
    database: dbCredentials.DB_NAME,     // Matches JSON key DB_NAME
  });

  try {
    await client.connect();
    const query = `
      UPDATE public."AppUsers"
      SET "verificationEmailSentAt" = NOW()
      WHERE email = $1;
    `;
    const res = await client.query(query, [email]);
    console.log('Update successful:', res);
  } catch (error) {
    console.error('Error updating verification timestamp:', error);
    throw error;
  } finally {
    await client.end();
  }
};


// Lambda handler function
exports.handler = async (event) => {
  try {
    // Fetch secrets for SendGrid API key, DB credentials, and domain
    const sendGridApiKey = await getSecretValue(SENDGRID_API_KEY_SECRET_NAME);
    const dbCredentials = await getSecretValue(DB_SECRET_NAME);
    const domain = await getSecretValue(DOMAIN_SECRET_NAME);

    console.log('DB Credentials:', dbCredentials);

    // Initialize SendGrid with the fetched API key
    sgMail.setApiKey(sendGridApiKey);

    console.log('Received event:', JSON.stringify(event, null, 2));

    // Parse the SNS message
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    console.log('Parsed SNS Message:', snsMessage);

    const { email, token, BASE_URL } = snsMessage;

    if (!email || !token || !BASE_URL) {
      throw new Error('Missing required fields in SNS message (email, token, or BASE_URL)');
    }

    // Construct the verification URL
    const verificationUrl = `${BASE_URL}?user=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

    // Construct the email
    const msg = {
      to: email,
      from: `${domain}`,
      subject: 'Verify Your Email',
      text: `Please verify your email by clicking the link: ${verificationUrl}`,
      html: `<p>Please verify your email by clicking <a href="${verificationUrl}">this link</a>. The link will expire in 2 minutes.</p>`,
    };

    // Send the email using SendGrid
    await sgMail.send(msg);
    console.log(`Verification email sent to ${email}`);

    // Update the timestamp in the database
    await updateUserVerificationTimestamp(email, dbCredentials);
    console.log(`Timestamp for verification email sent is stored in the database for ${email}.`);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Verification email sent to ${email} and timestamp stored in the database.` }),
    };
  } catch (error) {
    console.error('Error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to send verification email or log it in the database', error: error.message }),
    };
  }
};