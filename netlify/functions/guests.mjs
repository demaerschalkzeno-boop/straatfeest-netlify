import { getStore } from "@netlify/blobs";

const STORE_NAME = "verzoeningstraat-feest-2026";
const allowedDays = new Set(["zaterdag", "zondag", "beide"]);
const allowedStatuses = new Set(["present", "not-coming"]);

function clean(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

function getGuestStore(context) {
  const siteID = context?.site?.id || undefined;
  return getStore({ name: STORE_NAME, siteID, consistency: "strong" });
}

async function readGuests(store) {
  const { blobs } = await store.list({ prefix: "house/" });
  const guests = await Promise.all(blobs.map(async ({ key }) => {
    const value = await store.get(key);
    if (!value) return null;
    try {
      const guest = JSON.parse(value);
      return guest && typeof guest === "object" ? guest : null;
    } catch {
      return null;
    }
  }));

  return guests
    .filter(Boolean)
    .sort((a, b) => Number(a.houseNumber) - Number(b.houseNumber));
}

function validateGuest(body) {
  const firstName = clean(body?.firstName, 40);
  const houseNumber = clean(body?.houseNumber, 2);
  const bring = clean(body?.bring, 120);
  const day = clean(body?.day, 10);
  const status = clean(body?.status || "present", 12);
  const numericHouseNumber = Number(houseNumber);

  if (!firstName) return { error: "Vul je voornaam in." };
  if (!/^\d+$/.test(houseNumber) || numericHouseNumber < 1 || numericHouseNumber > 48) {
    return { error: "Vul een huisnummer van 1 tot en met 48 in." };
  }
  if (!allowedDays.has(day)) return { error: "Kies zaterdag, zondag of beide dagen." };
  if (!allowedStatuses.has(status)) return { error: "Ongeldige aanwezigheidsstatus." };

  return { guest: { firstName, houseNumber, day, bring, status } };
}

function validateHouseNumber(value) {
  const houseNumber = clean(value, 2);
  const numericHouseNumber = Number(houseNumber);
  if (!/^\d+$/.test(houseNumber) || numericHouseNumber < 1 || numericHouseNumber > 48) {
    return { error: "Vul een huisnummer van 1 tot en met 48 in." };
  }
  return { houseNumber };
}

export default async (request, context) => {
  try {
    const store = getGuestStore(context);

    if (request.method === "GET") {
      return response({ guests: await readGuests(store) });
    }

    if (request.method === "DELETE") {
      let body;
      try {
        body = await request.json();
      } catch {
        return response({ error: "Ongeldige gegevens ontvangen." }, 400);
      }

      const validated = validateHouseNumber(body?.houseNumber);
      if (validated.error) return response(validated, 400);

      await store.delete("house/" + validated.houseNumber);
      return response({ guests: await readGuests(store) });
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return response({ error: "Ongeldige gegevens ontvangen." }, 400);
      }

      const validated = validateGuest(body);
      if (validated.error) return response(validated, 400);

      const { guest } = validated;
      await store.set("house/" + guest.houseNumber, JSON.stringify(guest));
      return response({ guests: await readGuests(store) }, 201);
    }

    return response({ error: "Deze actie wordt niet ondersteund." }, 405);
  } catch (error) {
    console.error("Guests function failed", error);
    return response({ error: "De gedeelde lijst is tijdelijk niet bereikbaar. Controleer of Netlify Blobs actief is en probeer opnieuw." }, 500);
  }
};