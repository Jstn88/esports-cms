const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const { GridFsStorage } = require('multer-gridfs-storage');
const multer = require('multer');

const app = express();
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3002'], // Admin & Public
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

mongoose.connect('mongodb://localhost:27017/esports-cms', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection failed:', err));

let gfs;
const conn = mongoose.connection;
conn.once('open', async () => {
  gfs = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: 'uploads' });
  await initializeDefaultData();
});
const storage = new GridFsStorage({
  url: 'mongodb://localhost:27017/esports-cms',
  file: (req, file) => ({ filename: `${Date.now()}-${file.originalname}`, bucketName: 'uploads' }),
});
const upload = multer({ storage });

const JWT_SECRET = 'your-secret-key';

// Schemas
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  role: { type: String, enum: ['organizer', 'player', 'spectator'], default: 'player' },
  email: String,
  games: [String],
  tournaments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' }],
  teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  elo: { type: Number, default: 1000 },
});
const User = mongoose.model('User', userSchema);

const teamSchema = new mongoose.Schema({
  name: String,
  captain: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  game: String,
  elo: { type: Number, default: 1000 },
  seed: Number,
  roles: [{ member: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, role: String }],
  created_at: { type: Date, default: Date.now },
});
const Team = mongoose.model('Team', teamSchema);

const sponsorSchema = new mongoose.Schema({
  name: String,
  logo: { fileId: mongoose.Types.ObjectId, filename: String },
  url: String,
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
  contribution: Number,
  created_at: { type: Date, default: Date.now },
});
const Sponsor = mongoose.model('Sponsor', sponsorSchema);

const pageSchema = new mongoose.Schema({
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
  title: String,
  bannerImage: { fileId: mongoose.Types.ObjectId, filename: String },
  description: String,
  sections: [{ type: String, content: String, image: { fileId: mongoose.Types.ObjectId, filename: String } }],
  theme: { type: String, default: 'dark' },
  metaTags: { title: String, description: String, keywords: [String] },
  created_at: { type: Date, default: Date.now },
});
const Page = mongoose.model('Page', pageSchema);

const tournamentSchema = new mongoose.Schema({
  name: String,
  game: String,
  start_date: Date,
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed'], default: 'upcoming' },
  organizer: String,
  is_team_based: Boolean,
  active_players: { type: Number, default: 0 },
  active_teams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  current_funds: { type: Number, default: 0 },
  prize_pool: { type: Number, default: 0 },
  prize_distribution: [{ rank: Number, amount: Number }],
  crowdfunding_goal: Number,
  stretch_goals: [{ description: String, amount: Number }],
  uploads: [{ fileId: mongoose.Types.ObjectId, filename: String }],
  messages: [{ user: String, text: String, type: { type: String, default: 'discussion' }, timestamp: { type: Date, default: Date.now } }],
  stream_url: String,
  sponsors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sponsor' }],
  bracket: {
    type: { type: String, enum: ['single_elimination', 'double_elimination', 'round_robin'] },
    rounds: [[{ player1: String, player2: String, winner: String, date: Date, seed1: Number, seed2: Number, status: String }]],
    winners: [[{ player1: String, player2: String, winner: String, date: Date, seed1: Number, seed2: Number, status: String }]],
    losers: [[{ player1: String, player2: String, winner: String, date: Date, seed1: Number, seed2: Number, status: String }]],
    grandFinal: { player1: String, player2: String, winner: String, date: Date, seed1: Number, seed2: Number, status: String },
  },
  stats: {
    totalMatches: { type: Number, default: 0 },
    completedMatches: { type: Number, default: 0 },
    avgMatchTime: { type: Number, default: 0 },
    participantEngagement: { type: Number, default: 0 },
  },
  schedule: [{ matchId: String, time: Date, location: String, reminderSent: Boolean }],
});
const Tournament = mongoose.model('Tournament', tournamentSchema);

async function initializeDefaultData() {
  const adminExists = await User.findOne({ username: 'admin', role: 'organizer' });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = new User({
      username: 'admin',
      password: hashedPassword,
      role: 'organizer',
      email: 'admin@example.com',
      games: [],
      tournaments: [],
      teams: [],
    });
    await admin.save();
  }
  const playersExist = await User.countDocuments({ role: 'player' });
  if (playersExist < 4) {
    const samplePlayers = ['player1', 'player2', 'player3', 'player4'].map(username => ({
      username,
      password: bcrypt.hashSync('pass123', 10),
      role: 'player',
      email: `${username}@example.com`,
      games: [],
      tournaments: [],
      teams: [],
    }));
    await User.insertMany(samplePlayers);
  }
  const teamsExist = await Team.countDocuments();
  if (teamsExist === 0) {
    const admin = await User.findOne({ username: 'admin' });
    const players = await User.find({ role: 'player' }).limit(3);
    const team = new Team({
      name: 'Admin Team',
      captain: admin._id,
      members: players.map(p => p._id),
      game: 'Rocket League',
      seed: 1,
      roles: [{ member: admin._id, role: 'captain' }],
    });
    await team.save();
    admin.teams.push(team._id);
    players.forEach(p => p.teams.push(team._id));
    await admin.save();
    await Promise.all(players.map(p => p.save()));
  }
  const tournamentsExist = await Tournament.countDocuments();
  if (tournamentsExist === 0) {
    const team = await Team.findOne({ name: 'Admin Team' });
    const tournament = new Tournament({
      name: 'Spring Clash 2025',
      game: 'Rocket League',
      start_date: new Date('2025-03-15'),
      status: 'upcoming',
      organizer: 'admin',
      is_team_based: true,
      active_teams: [team._id],
      current_funds: 0,
      prize_pool: 500,
      prize_distribution: [{ rank: 1, amount: 300 }, { rank: 2, amount: 150 }, { rank: 3, amount: 50 }],
      crowdfunding_goal: 1000,
      stretch_goals: [{ description: 'Extra Prize', amount: 500 }],
      uploads: [],
      messages: [{ user: 'admin', text: 'Welcome to Spring Clash!', type: 'announcement' }],
      stream_url: 'https://twitch.tv/springclash',
      sponsors: [],
      bracket: { type: 'single_elimination', rounds: [[{ player1: 'Admin Team', player2: 'TBD', winner: null, date: new Date('2025-03-15T14:00:00'), seed1: 1, seed2: null, status: 'scheduled' }]] },
      schedule: [{ matchId: 'match1', time: new Date('2025-03-15T14:00:00'), location: 'Online', reminderSent: false }],
    });
    await tournament.save();
    const admin = await User.findOne({ username: 'admin' });
    admin.tournaments.push(tournament._id);
    await admin.save();
    const sponsor = new Sponsor({
      name: 'GameSponsor',
      logo: null,
      url: 'https://gamesponsor.com',
      tournamentId: tournament._id,
      contribution: 200,
    });
    await sponsor.save();
    tournament.sponsors.push(sponsor._id);
    await tournament.save();
  }
}

const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!['organizer', 'player', 'spectator'].includes(req.user.role)) return res.status(403).json({ error: 'Invalid role' });
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid token' });
  }
};

// Authentication Routes
app.post('/register', async (req, res) => {
  try {
    const { username, password, email, role = 'player' } = req.body;
    if (!['organizer', 'player', 'spectator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, role, email, games: [], tournaments: [], teams: [] });
    await user.save();
    res.status(201).json({ message: 'User registered' });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/user/role', authenticateToken, (req, res) => {
  res.json({ role: req.user.role });
});

// Tournament Routes
app.get('/tournaments', authenticateToken, async (req, res) => {
  try {
    const query = req.user.role === 'organizer' ? { organizer: req.user.username } : {};
    const tournaments = await Tournament.find(query).populate('active_teams sponsors');
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

app.post('/tournaments', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'organizer') return res.status(403).json({ error: 'Organizers only' });
    const { name, game, start_date, is_team_based, crowdfunding_goal, prize_pool, prize_distribution, stream_url, bracket_type = 'single_elimination' } = req.body;
    const tournament = new Tournament({
      name,
      game,
      start_date,
      status: 'upcoming',
      organizer: req.user.username,
      is_team_based,
      active_players: 0,
      active_teams: [],
      current_funds: 0,
      prize_pool,
      prize_distribution,
      crowdfunding_goal,
      stretch_goals: [],
      uploads: [],
      messages: [],
      stream_url,
      sponsors: [],
      bracket: { type: bracket_type, rounds: [[]] },
      schedule: [],
    });
    await tournament.save();
    const user = await User.findById(req.user.id);
    user.tournaments.push(tournament._id);
    await user.save();
    res.status(201).json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create tournament' });
  }
});

app.put('/tournaments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const tournament = await Tournament.findByIdAndUpdate(id, updates, { new: true });
    if (!tournament || (req.user.role !== 'organizer' && tournament.organizer !== req.user.username)) return res.status(404).json({ error: 'Tournament not found or unauthorized' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tournament' });
  }
});

app.post('/tournaments/:id/register', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { teamId } = req.body;
    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (req.user.role !== 'organizer' && !tournament.active_teams.includes(teamId)) {
      if (tournament.is_team_based) {
        const team = await Team.findById(teamId);
        if (!team || !team.members.some(m => m.toString() === req.user.id)) return res.status(403).json({ error: 'Not a team member' });
        tournament.active_teams.push(teamId);
      } else {
        tournament.active_players += 1;
      }
    }
    await tournament.save();
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/tournaments/:id/donate', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    const tournament = await Tournament.findById(id);
    tournament.current_funds += Number(amount);
    await tournament.save();
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Donation failed' });
  }
});

app.post('/tournaments/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, type } = req.body;
    const tournament = await Tournament.findById(id);
    tournament.messages.push({ user: req.user.username, text, type });
    await tournament.save();
    io.emit('messageUpdate', tournament);
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Message failed' });
  }
});

app.post('/tournaments/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id);
    tournament.uploads.push({ fileId: req.file.id, filename: req.file.filename });
    await tournament.save();
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/tournaments/:id/upload/:fileId', authenticateToken, (req, res) => {
  try {
    const { fileId } = req.params;
    const downloadStream = gfs.openDownloadStream(new mongoose.Types.ObjectId(fileId));
    downloadStream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

app.post('/tournaments/:id/bracket', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rIdx, mIdx, player1, player2, winner, date, seed1, seed2, status, isLosers } = req.body;
    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    let targetBracket = isLosers ? tournament.bracket.losers : tournament.bracket.winners || tournament.bracket.rounds;
    if (rIdx === 0 && mIdx === 0 && !isLosers && tournament.bracket.type === 'double_elimination') {
      tournament.bracket.grandFinal = { player1, player2, winner, date: date ? new Date(date) : null, seed1, seed2, status };
    } else {
      if (!targetBracket[rIdx]) targetBracket[rIdx] = [];
      targetBracket[rIdx][mIdx] = { player1, player2, winner, date: date ? new Date(date) : null, seed1, seed2, status };
      if (status === 'completed') {
        tournament.stats.completedMatches += 1;
        tournament.stats.totalMatches = targetBracket.reduce((sum, round) => sum + round.length, 0);
      }
    }
    await tournament.save();
    io.emit('bracketUpdate', tournament);
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Bracket update failed' });
  }
});

app.post('/tournaments/:id/seed', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { teamId, seed } = req.body;
    const team = await Team.findById(teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    team.seed = seed;
    await team.save();
    res.json(team);
  } catch (err) {
    res.status(500).json({ error: 'Seeding failed' });
  }
});

app.post('/tournaments/:id/schedule', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { matchId, time, location } = req.body;
    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    tournament.schedule.push({ matchId, time: new Date(time), location, reminderSent: false });
    await tournament.save();
    io.emit('scheduleUpdate', tournament);
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Schedule update failed' });
  }
});

app.post('/tournaments/:id/sponsors', authenticateToken, upload.single('logo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, url, contribution } = req.body;
    const tournament = await Tournament.findById(id);
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    const sponsor = new Sponsor({
      name,
      logo: req.file ? { fileId: req.file.id, filename: req.file.filename } : null,
      url,
      tournamentId: id,
      contribution,
    });
    await sponsor.save();
    tournament.sponsors.push(sponsor._id);
    await tournament.save();
    res.status(201).json(sponsor);
  } catch (err) {
    res.status(500).json({ error: 'Sponsor creation failed' });
  }
});

// Team Routes
app.get('/teams', authenticateToken, async (req, res) => {
  try {
    const teams = await Team.find().populate('captain members');
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

app.post('/teams', authenticateToken, async (req, res) => {
  try {
    const { name, game, memberUsernames, roles = [] } = req.body;
    const captain = await User.findById(req.user.id);
    const members = await User.find({ username: { $in: memberUsernames } });
    const team = new Team({
      name,
      captain: captain._id,
      members: members.map(m => m._id),
      game,
      seed: null,
      roles: roles.map(r => ({ member: r.member, role: r.role })),
    });
    await team.save();
    captain.teams.push(team._id);
    members.forEach(m => m.teams.push(team._id));
    await captain.save();
    await Promise.all(members.map(m => m.save()));
    res.status(201).json(team);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create team' });
  }
});

app.put('/teams/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, memberUsernames, roles } = req.body;
    const team = await Team.findById(id);
    if (!team || team.captain.toString() !== req.user.id) return res.status(403).json({ error: 'Only captain can edit team' });
    team.name = name || team.name;
    if (memberUsernames) {
      const newMembers = await User.find({ username: { $in: memberUsernames } });
      team.members = newMembers.map(m => m._id);
    }
    if (roles) team.roles = roles.map(r => ({ member: r.member, role: r.role }));
    await team.save();
    res.json(team);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// Page Routes
app.get('/tournaments/:id/page', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const page = await Page.findOne({ tournamentId: id });
    res.json(page || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

app.post('/tournaments/:id/page', authenticateToken, upload.fields([{ name: 'bannerImage', maxCount: 1 }, { name: 'sectionImages', maxCount: 5 }]), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, sections, theme, metaTags } = req.body;
    const tournament = await Tournament.findById(id);
    if (!tournament || (req.user.role !== 'organizer' && tournament.organizer !== req.user.username)) return res.status(404).json({ error: 'Tournament not found or unauthorized' });
    let page = await Page.findOne({ tournamentId: id });
    const bannerImage = req.files['bannerImage'] ? { fileId: req.files['bannerImage'][0].id, filename: req.files['bannerImage'][0].filename } : page?.bannerImage;
    const parsedSections = JSON.parse(sections).map((s, i) => ({
      type: s.type,
      content: s.content,
      image: req.files['sectionImages'] && req.files['sectionImages'][i] ? { fileId: req.files['sectionImages'][i].id, filename: req.files['sectionImages'][i].filename } : s.image,
    }));
    if (page) {
      page.title = title || page.title;
      page.bannerImage = bannerImage;
      page.description = description || page.description;
      page.sections = parsedSections;
      page.theme = theme || page.theme;
      page.metaTags = metaTags ? JSON.parse(metaTags) : page.metaTags;
    } else {
      page = new Page({
        tournamentId: id,
        title,
        bannerImage,
        description,
        sections: parsedSections,
        theme,
        metaTags: metaTags ? JSON.parse(metaTags) : { title: '', description: '', keywords: [] },
      });
    }
    await page.save();
    res.json(page);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save page' });
  }
});

// Public Routes (for future public site)
app.get('/public/tournaments', async (req, res) => {
  try {
    const tournaments = await Tournament.find({ status: { $in: ['upcoming', 'ongoing'] } }).populate('active_teams sponsors');
    res.json(tournaments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch public tournaments' });
  }
});

app.get('/public/tournaments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).populate('active_teams sponsors');
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    res.json(tournament);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

app.get('/public/tournaments/:id/page', async (req, res) => {
  try {
    const { id } = req.params;
    const page = await Page.findOne({ tournamentId: id });
    res.json(page || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

// Sponsor Routes
app.get('/tournaments/:id/sponsors', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sponsors = await Sponsor.find({ tournamentId: id });
    res.json(sponsors);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sponsors' });
  }
});

app.put('/tournaments/:id/sponsors/:sponsorId', authenticateToken, async (req, res) => {
  try {
    const { id, sponsorId } = req.params;
    const updates = req.body;
    const sponsor = await Sponsor.findByIdAndUpdate(sponsorId, updates, { new: true });
    if (!sponsor || sponsor.tournamentId.toString() !== id) return res.status(404).json({ error: 'Sponsor not found or unauthorized' });
    res.json(sponsor);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update sponsor' });
  }
});

// Analytics Routes
app.get('/tournaments/:id/analytics', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const tournament = await Tournament.findById(id).populate('active_teams');
    if (!tournament || (req.user.role !== 'organizer' && tournament.organizer !== req.user.username)) return res.status(404).json({ error: 'Tournament not found or unauthorized' });
    const analytics = {
      participants: tournament.is_team_based ? tournament.active_teams.length : tournament.active_players,
      funds: tournament.current_funds,
      prizePool: tournament.prize_pool,
      matchesPlayed: tournament.stats.completedMatches,
      totalMatches: tournament.stats.totalMatches,
      engagement: tournament.stats.participantEngagement,
      sponsors: tournament.sponsors.length,
      messages: tournament.messages.length,
      uploads: tournament.uploads.length,
    };
    res.json(analytics);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

const server = app.listen(3001, () => console.log('Server running on http://localhost:3001'));
const io = socketIo(server, { cors: { origin: ['http://localhost:3000', 'http://localhost:3002'] } });

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('bracketUpdate', (updatedTournament) => io.emit('bracketUpdate', updatedTournament));
  socket.on('messageUpdate', (updatedTournament) => io.emit('messageUpdate', updatedTournament));
  socket.on('scheduleUpdate', (updatedTournament) => io.emit('scheduleUpdate', updatedTournament));
  socket.on('disconnect', () => console.log('Client disconnected'));
});