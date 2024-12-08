const express = require("express");
const puppeteer = require("puppeteer");
const ExcelJS = require("exceljs");
const cors = require("cors");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

app.get("/scrape", async (req, res) => {
  const { leagueUrl, maxMatches } = req.query;
  const maxLinks = maxMatches ? parseInt(maxMatches, 10) : 100;

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(leagueUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector(".eventRowLink");

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".eventRowLink")).map(
        (a) => a.href + "/statystyki-meczu/0"
      )
    );
    const linksDetails = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".eventRowLink")).map(
        (a) => a.href + "/szczegoly-meczu"
      )
    );

    const allData = [];
    const events = [];
    let count = 0;

    // Pobieranie danych szczegółowych
    for (const link of linksDetails) {
      if (count >= maxLinks) break;

      const matchPage = await browser.newPage();
      try {
        await matchPage.goto(link, { waitUntil: "networkidle0", timeout: 60000 });
        await matchPage.waitForSelector("#detail");

        const eventsOneMatch = await matchPage.evaluate(() => {
          const rows = document.querySelectorAll(".smv__participantRow");
          return Array.from(rows).map((section) => {
            const timeBox = section.querySelector(".smv__timeBox");
            const playerName = section.querySelector(".smv__playerName");
            const eventTypeIcon = section.querySelector(
              ".smv__incidentIcon use, .smv__incidentIconSub use"
            );
            const eventTitle = eventTypeIcon
              ? eventTypeIcon.getAttribute("xlink:href")
              : null;
            const eventDescription =
              eventTypeIcon?.closest("div").getAttribute("title") || "";

            let eventType = "Inne";
            if (eventTitle && eventTitle.includes("card")) {
              eventType = eventDescription.includes("żółta")
                ? "Żółta kartka"
                : "Czerwona kartka";
            } else if (eventTitle && eventTitle.includes("goal")) {
              eventType = "Bramka";
            } else if (eventTitle && eventTitle.includes("substitution")) {
              eventType = "Zmiana";
            }

            return {
              time: timeBox ? timeBox.innerText.trim() : null,
              player: playerName ? playerName.innerText.trim() : null,
              event: eventType,
            };
          });
        });

        events.push(eventsOneMatch);
      } catch (err) {
        console.warn(`Błąd podczas przetwarzania szczegółów meczu: ${err.message}`);
      } finally {
        await matchPage.close();
      }
      count++;
    }

    // Pobieranie danych statystycznych
    count = 0;
    for (const link of links) {
      if (count >= maxLinks) break;

      const matchPage = await browser.newPage();
      try {
        await matchPage.goto(link, { waitUntil: "networkidle0", timeout: 60000 });
        await matchPage.waitForSelector("#detail");

        const matchData = await matchPage.evaluate(() => {
          const detailElement = document.getElementById("detail");
          const section = detailElement.querySelectorAll(":scope > .section")[0];
          return section.innerText.trim().split("\n");
        });

        const cleanedData = matchData.filter((data) => data.trim().length > 0);

        let matchStats = [];
        for (let i = 0; i < cleanedData.length; i += 3) {
          if (i + 2 < cleanedData.length) {
            const homeValue = cleanedData[i];
            const label = cleanedData[i + 1];
            const awayValue = cleanedData[i + 2];
            matchStats.push({ home: homeValue, label, away: awayValue });
          }
        }

        allData.push(matchStats);
      } catch (err) {
        console.warn(`Błąd podczas pobierania statystyk meczu: ${err.message}`);
      } finally {
        await matchPage.close();
      }
      count++;
    }

    await browser.close();

    // Tworzenie pliku Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Statystyki");

    worksheet.columns = [
      { header: "Statystyka", key: "label", width: 30 },
      { header: "Gospodarze", key: "home", width: 15 },
      { header: "Goście", key: "away", width: 15 },
      { header: "Czas", key: "time", width: 15 },
      { header: "Zawodnik", key: "player", width: 30 },
      { header: "Zdarzenie", key: "event", width: 30 },
    ];

    const mergedData = [];
    for (let i = 0; i < allData.length; i++) {
      const stats = allData[i];
      const matchEvents = events[i];
      stats.forEach((stat, idx) => {
        mergedData.push({
          label: stat.label,
          home: stat.home,
          away: stat.away,
          time: matchEvents[idx]?.time || null,
          player: matchEvents[idx]?.player || null,
          event: matchEvents[idx]?.event || null,
        });
      });
    }

    mergedData.forEach((data) => {
      worksheet.addRow(data);
    });

    const filePath = "./statystyki.xlsx";
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath);
  } catch (err) {
    console.error("Błąd podczas przetwarzania:", err.message);
    res.status(500).send("Wystąpił błąd.");
  }
});

app.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
