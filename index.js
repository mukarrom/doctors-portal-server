const express = require('express');
const cors = require('cors');
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

async function run() {
	try {
		await client.connect();
		const serviceCollection = client
			.db('doctors_portal')
			.collection('services');
		const bookingCollection = client
			.db('doctors_portal')
			.collection('bookings');

		/**
		 * API Naming Convention
		 * app.get('/service') // available services
		 * app.get('/booking') // get all booking in this collection
		 * app.get('/booking/:id') // get a specific booking
		 * app.post('/booking') // add a new booking
		 * app.patch('/booking/:id') // update a booking
		 * app.delete('/booking/:id') // delete a booking
		 */

		app.get('/services', async (req, res) => {
			const query = {};
			const cursor = serviceCollection.find(query);
			const services = await cursor.toArray();
			res.send(services);
		});

		// Post : /booking
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
			res.send({ success: true, booking: result });
		});

		// >-> get : available
		// >-> do not use this in the future. rather use aggregate, learn more about mongodb
		app.get('/available', async (req, res) => {
			const date = req.query.date;
			// step 1: get all service
			const services = await serviceCollection.find().toArray();

			const query = { date: date };

			// step 2: get the booking of that day
			const bookings = await bookingCollection.find(query).toArray();

			// step 3: for each service
			services.forEach(service => {
				// step 4: find booking for this service. out: [{},{},{}]
				const serviceBookings = bookings.filter(
					book => book.treatment === service.name
				);

				// step 5: select slots for the service bookings: ["","",""]
				const bookedSlot = serviceBookings.map(booked => booked.slot);

				// step 6: select those slots that are not in bookedSlot
				const available = service.slots.filter(
					slot => !bookedSlot.includes(slot)
				);
				// step 7: set available to slots to make it easier
				service.slots = available;
			});

			res.send(services);
		});

		// app.get('/available', async (req, res) => {
		// 	const date = req.query.date || 'Nov 19, 2022';

		// 	// step 1: get all services
		// 	const services = await serviceCollection.find().toArray();
		// 	// step 2: get the booking of that day
		// 	const query = { date: date };
		// 	const bookings = await bookingCollection.find(query).toArray();

		// 	// step 3: for each service, find booking for that service
		// 	services.forEach(service => {
		// 		const serviceBookings = bookings.filter(
		// 			b => b.treatment === service.name
		// 		);
		// 		const booked = serviceBookings.map(s => s.slot);
		// 		const available = service.slots.filter(s => !booked.includes(s));
		// 		service.available = available;
		// 	});

		// 	res.send(services);
		// });
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
