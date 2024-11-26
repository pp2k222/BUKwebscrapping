const MaksymalnaLiczbaMeczy = 100;
const LinkDoLigi =
  "https://www.flashscore.pl/pilka-nozna/anglia/premier-league/wyniki/";
const express = require("express");
const puppeteer = require("puppeteer");
const ExcelJS = require("exceljs");
const PORT = process.env.PORT || 3000;  // Użyj portu 3000, jeśli nie ustawiono w środowisku
const app = express();

app.get('/', (req, res) => {
  res.send("Hello, this is your web scraping service!");
});

// Now, start the Puppeteer scraping task when the server is ready
app.get('/scrape', async (req, res) => {
  try {
    const mainBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const mainPage = await mainBrowser.newPage();
    await mainPage.goto(LinkDoLigi, { waitUntil: 'networkidle0', timeout: 60000 });
    await mainPage.waitForSelector(".eventRowLink");

    const links = await mainPage.evaluate(() => {
      return Array.from(document.querySelectorAll(".eventRowLink")).map(
        (a) => a.href + "/statystyki-meczu/0"
      );
    });
    const linksDetails = await mainPage.evaluate(() => {
      return Array.from(document.querySelectorAll(".eventRowLink")).map(
        (a) => a.href + "/szczegoly-meczu"
      );
    });
    const allData = [];
    let events = [];
    const maxLinks = MaksymalnaLiczbaMeczy;
    let count = 0;

    for (const link of linksDetails) {
      if (count >= maxLinks) break;

      const clientBrowser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await clientBrowser.newPage();
      await page.goto(link);
      try {
        await page.waitForSelector("#detail");

        const [homeTeam, awayTeam] = await page.evaluate(() => {
          const home = document
            .querySelector(".duelParticipant__home")
            ?.innerText.trim();
          const away = document
            .querySelector(".duelParticipant__away")
            ?.innerText.trim();
          return [home, away];
        });

        eventsOneMatch = await page.evaluate(() => {
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
            const eventTypeSocker = section.querySelector(
              ".smv__incidentIcon .soccer"
            );

            let eventType = "Inne";
            if (eventTitle && eventTitle.includes("card")) {
              eventType = eventDescription.includes("żółta")
                ? "Żółta kartka"
                : "Czerwona kartka";
            } else if (eventTypeSocker) {
              eventType = "Bramka";
            } else if (eventTitle && eventTitle.includes("substitution")) {
              eventType = "Zmiana";
            }

            return {
              time: timeBox ? timeBox.innerText.trim() : null,
              player: playerName ? playerName.innerText.trim() : null,
              incidentTitle: eventType,
            };
          });
        });

        events.push(eventsOneMatch);
      } catch (err) {
        console.warn("Element #detail nie został znaleziony.");
      }
      count++;
      await clientBrowser.close();
    }

    // Here you can generate and send the Excel file or other results
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Statystyki");

    worksheet.columns = [
      { header: "Statystyka", key: "label", width: 30 },
      { header: "Gospodarze", key: "home", width: 15 },
      { header: "Goście", key: "away", width: 15 },
      { header: "Mecz", key: "match", width: 30 },
      { header: "Mecz", key: "time", width: 30 },
      { header: "Mecz", key: "player", width: 30 },
      { header: "Mecz", key: "incidentTitle", width: 30 },
    ];

    const mergedData = [];  // Add merged data processing logic here
    mergedData.forEach((data) => {
      worksheet.addRow(data);
    });

    await workbook.xlsx.writeFile("statystyki.xlsx");

    // Respond with a success message
    res.send("Scraping completed and data saved to statystyki.xlsx");
    await mainBrowser.close();
  } catch (err) {
    console.error("An error occurred during scraping:", err);
    res.status(500).send("An error occurred during scraping");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
