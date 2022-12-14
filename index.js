const express = require('express');
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
require('dotenv').config();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cijpcbt.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
	serverApi: ServerApiVersion.v1,
});

// jwt middleware
function verifyJWT(req, res, next) {
	// get token from client side from headers
	const authHeader = req.headers.authorization;
	// check token exists or not, if not can't access
	if (!authHeader) {
		return res.status(401).send({ message: 'UnAuthorized Access' });
	}
	// split token
	const token = authHeader.split(' ')[1];
	jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
		if (err) {
			return res.status(403).send({ message: 'Forbidden access' });
		}
		req.decoded = decoded;
		next();
	});
}

const EmailSenderOptions = {
	auth: {
		api_key: process.env.EMAIL_SENDER_KEY,
	},
};
const mailer = nodemailer.createTransport(sgTransport(EmailSenderOptions));
const sendAppointmentEmail = (booking) => {
	const { patient, patientName, treatment, date, slot } = booking;
	const email = {
		to: patient,
		from: process.env.EMAIL_SENDER,
		subject: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed.`,
		text: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed.`,
		html: `
		<div>
			<p class="">Hello ${patientName}</p>
			<h3>Your appointment for ${treatment} is confirmed</h3>
			<p>Lookin forwore to seeing you on ${date} at ${slot}.</p>
			
			<h3>Our Address</h3>
			<p>2350 Bhairab, Kishoreganj</p>
			<p>Dhaka, Bangladesh</p>
			<a href="https://khidmait.com">Khidma it</a>
		</div>
		`,
	};
	mailer.sendMail(email, function (err, res) {
		if (err) {
			console.log(err);
		}
		console.log(res);
	});
};

async function run() {
	try {
		client.connect();
		const serviceCollection = client
			.db('doctors_portal')
			.collection('services');
		const bookingCollection = client
			.db('doctors_portal')
			.collection('bookings');
		const userCollection = client.db('doctors_portal').collection('users');
		const doctorCollection = client.db('doctors_portal').collection('doctors');

		// verify admin middleware
		const verifyAdmin = async (req, res, next) => {
			const requester = req.decoded.email;
			const requesterAccount = await userCollection.findOne({
				email: requester,
			});
			if (requesterAccount.role === 'admin') {
				next();
			} else {
				res.status(403).send({ message: 'Forbidden, Only admin can access' });
			}
		};
		/**
		 * API Naming Convention
		 * app.get('/service') // available services
		 * app.get('/booking') // get all booking in this collection
		 * app.get('/booking/:id') // get a specific booking
		 * app.post('/booking') // add a new booking
		 * app.patch('/booking/:id') // update a booking
		 * app.put('user/:email') // upsert => update or insert
		 * app.delete('/booking/:id') // delete a booking
		 */

		// get all users api
		app.get('/user', verifyJWT, async (req, res) => {
			res.send(await userCollection.find().toArray());
		});

		// check admin
		app.get('/admin/:email', async (req, res) => {
			const email = req.params.email;
			const user = await userCollection.findOne({ email: email });
			const isAdmin = user.role === 'admin';
			res.send(isAdmin);
		});

		// make admin
		app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
			// get email from url params
			const email = req.params.email;
			// filter
			const filter = { email: email };
			const updateDoc = {
				$set: { role: 'admin' },
			};
			// upsert in database
			const result = await userCollection.updateOne(filter, updateDoc);
			res.send(result);
		});

		// save new users in database and verify with jwt token
		app.put('/user/:email', async (req, res) => {
			// get email from url params
			const email = req.params.email;
			// get data from body
			const user = req.body;
			// filter
			const filter = { email: email };
			// option
			const option = { upsert: true };
			const updateDoc = {
				$set: user,
			};
			// upsert in database
			const result = await userCollection.updateOne(filter, updateDoc, option);
			const token = jwt.sign(
				{ email: email },
				process.env.ACCESS_TOKEN_SECRET,
				{ expiresIn: '1h' }
			);
			res.send({ result, token });
		});

		// get all services and slots
		app.get('/services', async (req, res) => {
			// const query = {};
			const cursor = serviceCollection.find().project({ name: 1 });
			const services = await cursor.toArray();
			res.send(services);
		});

		// Get: /booking   : get all booked slots with patient name and email
		app.get('/booking', verifyJWT, async (req, res) => {
			const patient = req.query.patient;
			const decodedEmail = req.decoded.email;
			if (patient === decodedEmail) {
				const query = { patient: patient };
				const booking = await bookingCollection.find(query).toArray();
				return res.send(booking);
			} else {
				return res.status(403).send({ message: 'Forbidden Access' });
			}
		});
		// Post : /booking  if anyone book a slots, save it in database;
		app.post('/booking', async (req, res) => {
			const booking = req.body;
			const query = {
				treatment: booking.treatment,
				date: booking.date,
				patient: booking.patient,
			};
			const exists = await bookingCollection.findOne(query);
			if (exists) {
				return res.send({ success: false, booking: exists });
			}
			const result = await bookingCollection.insertOne(booking);
			sendAppointmentEmail(booking);
			res.send({ success: true, booking: result });
		});

		// >-> get : available time slots
		// >-> do not use this in the future. rather use aggregate, learn more about mongodb
		app.get('/available', async (req, res) => {
			const date = req.query.date;
			// step 1: get all service
			const services = await serviceCollection.find().toArray();

			const query = { date: date };

			// step 2: get the booking of that day
			const bookings = await bookingCollection.find(query).toArray();

			// step 3: for each service
			services.forEach((service) => {
				// step 4: find booking for this service. out: [{},{},{}]
				const serviceBookings = bookings.filter(
					(book) => book.treatment === service.name
				);

				// step 5: select slots for the service bookings: ["","",""]
				const bookedSlot = serviceBookings.map((booked) => booked.slot);

				// step 6: select those slots that are not in bookedSlot
				const available = service.slots.filter(
					(slot) => !bookedSlot.includes(slot)
				);
				// step 7: set available to slots to make it easier
				service.slots = available;
			});

			res.send(services);
		});

		/**
		 * ==============>  doctors api
		 */
		// get doctors
		app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
			const doctors = await doctorCollection.find().toArray();
			res.send(doctors);
		});

		//	Post a doctor
		app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
			const doctor = req.body;
			const result = await doctorCollection.insertOne(doctor);
			res.send(result);
		});

		//	Delete a doctor
		app.delete('/doctors/:email', verifyJWT, verifyAdmin, async (req, res) => {
			const email = req.params.email;
			const filter = { email: email };
			const result = await doctorCollection.deleteOne(filter);
			res.send(result);
		});
	} finally {
	}
}
run().catch(console.dir);

app.get('/', (req, res) => {
	res.send('Hello Doctor uncle!');
});

app.listen(port, () => {
	console.log(`Doctors app listening on port ${port}`);
});
