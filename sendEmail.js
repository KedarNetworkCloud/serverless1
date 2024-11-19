const { Client } = require('pg');
const sgMail = require('@sendgrid/mail');

// Environment variables
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const DOMAIN = process.env.DOMAIN;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT || 5432;
const DB_NAME = process.env.DB_NAME;
const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;

// Initialize SendGrid API Key
sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
  const dbClient = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USERNAME,
    password: DB_PASSWORD,
  });

  try {
    // Parse the SNS message
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    const { email, token, BASE_URL } = snsMessage;

    console.log('SNS Message:', snsMessage);

    // Construct the verification URL
    const verificationUrl = `${BASE_URL}?user=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

    // Construct the email
    const msg = {
      to: email,
      from: DOMAIN,
      subject: 'Verify Your Email',
      text: `Please verify your email by clicking the link: ${verificationUrl}`,
      html: `<p>Please verify your email by clicking <a href="${verificationUrl}">this link</a>. The link will expire in 2 minutes.</p>`,
    };

    // Send the email
    await sgMail.send(msg);
    console.log(`Verification email sent to ${email}`);

    // Connect to the database
    await dbClient.connect();
    console.log('Connected to the database');

    // Update the database with the timestamp
    const updateQuery = `
      UPDATE AppUser 
      SET verificationEmailSentAt = NOW() 
      WHERE email = $1
    `;
    await dbClient.query(updateQuery, [email]);
    console.log(`Database updated for user: ${email}`);

    // Return a success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Verification email sent to ${email} and timestamp stored in the database.`,
      }),
    };
  } catch (error) {
    console.error('Error:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to send verification email or log it in the database.',
        error: error.message,
      }),
    };
  } finally {
    // Ensure the database connection is closed
    await dbClient.end();
    console.log('Database connection closed');
  }
};
