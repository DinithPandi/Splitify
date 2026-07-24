require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'splitify-backup-secret-key-12345';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from the parent root folder
app.use(express.static(path.join(__dirname, '..')));

// MongoDB Client Connection
let db = null;
let connectionPromise = null;
const client = new MongoClient(MONGO_URI);

async function getDatabase() {
  if (db) return db;

  if (!connectionPromise) {
    connectionPromise = client.connect()
      .then(() => {
        db = client.db();
        console.log('Connected successfully to MongoDB');
        return db;
      })
      .catch(err => {
        connectionPromise = null;
        console.error('Failed to connect to MongoDB', err);
        throw err;
      });
  }

  return connectionPromise;
}

// Authentication Middleware
const authenticateUser = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ authenticated: false, error: 'Unauthorized: No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ authenticated: false, error: 'Unauthorized: Invalid token' });
  }
};

// ==========================================================================
// Authentication Endpoints
// ==========================================================================

// Register Route
app.post('/api/auth/signup', async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const database = await getDatabase();
    const usersCollection = database.collection('users');

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Save new user
    const newUser = {
      email: email.toLowerCase(),
      username,
      password: passwordHash,
      createdAt: new Date()
    };

    const result = await usersCollection.insertOne(newUser);
    const userId = result.insertedId.toString();

    // Create JWT Token
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' });

    // Set secure cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: true, // Always true for Vercel production SSL
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(201).json({ success: true, username });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const database = await getDatabase();
    const usersCollection = database.collection('users');

    // Find user
    const user = await usersCollection.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    // Create JWT Token
    const token = jwt.sign({ userId: user._id.toString(), username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    // Set secure cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: true, // Always true for Vercel production SSL
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Check Session / Verify Auth
app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) {
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ authenticated: true, username: decoded.username });
  } catch (err) {
    res.json({ authenticated: false });
  }
});

// Logout Route
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// ==========================================================================
// Groups API Endpoints (MongoDB CRUD Sync)
// ==========================================================================

// Get all groups for authenticated user
app.get('/api/groups', authenticateUser, async (req, res) => {
  try {
    const database = await getDatabase();
    const groupsCollection = database.collection('groups');
    const groups = await groupsCollection.find({ userId: req.userId }).toArray();

    // Map _id (MongoDB primary key) to id for frontend compatibility
    const clientGroups = groups.map(g => ({
      id: g._id,
      name: g.name,
      currency: g.currency || 'LKR',
      friends: g.friends || [],
      expenses: g.expenses || [],
      groupType: g.groupType || 'split'
    }));

    res.json(clientGroups);
  } catch (err) {
    console.error('Fetch groups error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Upsert a group (create or update)
app.post('/api/groups', authenticateUser, async (req, res) => {
  const group = req.body;

  if (!group || !group.id || !group.name) {
    return res.status(400).json({ error: 'Invalid group data' });
  }

  try {
    const database = await getDatabase();
    const groupsCollection = database.collection('groups');

    // Update document using frontend ID as MongoDB _id
    await groupsCollection.updateOne(
      { _id: group.id, userId: req.userId },
      {
        $set: {
          name: group.name,
          currency: group.currency || 'LKR',
          friends: group.friends || [],
          expenses: group.expenses || [],
          groupType: group.groupType || 'split'
        }
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Save group error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Delete a group
app.delete('/api/groups/:id', authenticateUser, async (req, res) => {
  const groupId = req.params.id;

  if (!groupId) {
    return res.status(400).json({ error: 'Group ID is required' });
  }

  try {
    const database = await getDatabase();
    const groupsCollection = database.collection('groups');
    const result = await groupsCollection.deleteOne({ _id: groupId, userId: req.userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Group not found or unauthorized' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Serve frontend main page on any other route for SPA compatibility
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Local listening hook (ignored by Vercel serverless environment)
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
