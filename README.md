# fly-buddy

A phone-friendly arrival tracker. Enter a flight number such as `WN4546` and fly-buddy shows the departure and arrival airports, the arrival terminal and gate, the arrival time, and whether the flight is running late. An en route map draws the planned path and, once the flight is airborne, the track flown so far.

Add a starting address and fly-buddy estimates a typical drive to the arrival airport, then tells you when to leave so you reach the curb a few minutes after arrival.

Arrival details come from the public FlightAware flight page. Drive times use OpenStreetMap geocoding and the public OSRM router. The drive estimate is a typical route, not live traffic.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run lint
```
