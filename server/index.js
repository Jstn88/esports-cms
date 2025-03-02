const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/gameclash', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Mongoose Schemas
const tournamentSchema = new mongoose.Schema({
  name: String,
  date: String,
  status: String,
  prizePool: String,
});
const Tournament = mongoose.model('Tournament', tournamentSchema);

const teamSchema = new mongoose.Schema({
  name: String,
  elo: Number,
  members: [String],
});
const Team = mongoose.model('Team', teamSchema);

const messageSchema = new mongoose.Schema({
  user: String,
  message: String,
  timestamp: Date,
});
const Message = mongoose.model('Message', messageSchema);

// Mock Data (Seed on startup if empty)
const seedData = async () => {
  if (await Tournament.countDocuments() === 0) {
    await Tournament.insertMany([
      { name: 'Global Smash Battle', date: '2025-04-15', status: 'Active', prizePool: '$10,000' },
      { name: 'Cyber Arena Cup', date: '2025-05-20', status: 'Upcoming', prizePool: '$5,000' },
    ]);
  }
  if (await Team.countDocuments() === 0) {
    await Team.insertMany([
      { name: 'Fire Falcons', elo: 1800, members: ['Player1', 'Player2'] },
      { name: 'Shadow Blades', elo: 1650, members: ['Player3', 'Player4'] },
    ]);
  }
  if (await Message.countDocuments() === 0) {
    await Message.insertMany([
      { user: 'Organizer', message: 'Tournament registration opens tomorrow!', timestamp: new Date() },
      { user: 'Player1', message: 'Ready for the match!', timestamp: new Date() },
    ]);
  }
};
seedData();

// Routes
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
};

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username, role: 'organizer' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/tournaments', authenticate, async (req, res) => res.json({ tournaments: await Tournament.find() }));
app.get('/teams', authenticate, async (req, res) => res.json({ teams: await Team.find() }));
app.get('/messages', authenticate, async (req, res) => res.json({ messages: await Message.find() }));
app.get('/user/role', authenticate, (req, res) => res.json({ role: req.user.role }));
app.get('/public/tournaments/:id', async (req, res) => {
  const tournament = await Tournament.findOne({ _id: req.params.id });
  if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
  res.json({ id: tournament._id, name: tournament.name, public: true });
});

// Socket.IO Events with Real-Time Triggers
io.on('connection', (socket) => {
  console.log('Client connected via', socket.conn.transport.name, 'ID:', socket.id);

  // Fetch and emit initial data
  const emitInitialData = async () => {
    socket.emit('tournamentUpdate', await Tournament.find());
    socket.emit('teamUpdate', await Team.find());
    socket.emit('message', await Message.find());
  };
  emitInitialData();

  // Handle updates
  socket.on('tournamentUpdate', async (data) => {
    await Tournament.findOneAndUpdate({ _id: data._id }, data, { upsert: true });
    socket.broadcast.emit('tournamentUpdate', await Tournament.find());
  });
  socket.on('teamUpdate', async (data) => {
    await Team.findOneAndUpdate({ _id: data._id }, data, { upsert: true });
    socket.broadcast.emit('teamUpdate', await Team.find());
  });
  socket.on('message', async (data) => {
    await Message.create(data);
    socket.broadcast.emit('message', await Message.find());
  });

  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
  socket.on('error', (err) => console.error('Socket error:', err));
});

server.listen(3001, () => console.log('Server running on http://localhost:3001'));