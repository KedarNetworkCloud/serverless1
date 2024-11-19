const sgMail = require('@sendgrid/mail');
const { Client } = require('pg');

// Environment variables
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const DOMAIN = process.env.DOMAIN;
const DB_HOST = process.env.DB_HOST_NO_PORT;
const DB_PORT = process.env.DB_PORT || 5432;
const DB_NAME = process.env.DB_NAME;
const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;

// Log the values for debugging
console.log("SENDGRID_API_KEY:", SENDGRID_API_KEY ? "Loaded" : "Not Set");
console.log("DOMAIN:", DOMAIN);
console.log("DB_HOST:", DB_HOST);
console.log("DB_PORT:", DB_PORT);
console.log("DB_NAME:", DB_NAME);
console.log("DB_USERNAME:", DB_USERNAME);
console.log("DB_PASSWORD:", DB_PASSWORD ? "Loaded" : "Not Set (empty)");

// Initialize SendGrid API Key
sgMail.setApiKey(SENDGRID_API_KEY);

// Define the function to send email and update the database
const updateUserVerificationTimestamp = async (email) => {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    // Connect to the PostgreSQL database
    await client.connect();

    // Construct the SQL query to update the verificationEmailSentAt column
    const query = `
      UPDATE public."AppUsers"                       -- Table to update
      SET "verificationEmailSentAt" = NOW()            -- Set the current timestamp
      WHERE email = $1;                              -- Specify the user's email
    `;

    // Execute the query with the email parameter
    const res = await client.query(query, [email]);
    console.log('Update successful:', res);
  } catch (error) {
    console.error('Error updating verification timestamp:', error);
  } finally {
    // Close the client connection
    await client.end();
  }
};

exports.handler = async (event) => {
  try {
    // Log the entire event to help debug its structure
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Parse the SNS message
    const snsMessage = JSON.parse(event.Records[0].Sns.Message);
    console.log('Parsed SNS Message:', snsMessage);

    // Extract fields from the parsed SNS message
    const { email, token, BASE_URL } = snsMessage;

    // Check if email, token, and BASE_URL are present
    if (!email || !token || !BASE_URL) {
      throw new Error('Missing required fields in SNS message (email, token, or BASE_URL)');
    }

    // Construct the verification URL
    const verificationUrl = `${BASE_URL}?user=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

    // Construct the email
    const msg = {
      to: email,
      from: `${DOMAIN}`, // "from" address using the domain
      subject: 'Verify Your Email',
      text: `Please verify your email by clicking the link: ${verificationUrl}`,
      html: `<p>Please verify your email by clicking <a href="${verificationUrl}">this link</a>. The link will expire in 2 minutes.</p>`,
    };

    // Send the email using SendGrid
    await sgMail.send(msg);
    console.log(`Verification email sent to ${email}`);

    // After email is sent successfully, update the timestamp in the database
    await updateUserVerificationTimestamp(email);
    console.log(`Timestamp for verification email sent is stored in the database for ${email}.`);

    // Return a success response
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Verification email sent to ${email} and timestamp stored in the database.` }),
    };
  } catch (error) {
    console.error('Error:', error);

    // Return a failure response
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Failed to send verification email or log it in the database', error: error.message }),
    };
  }
};
