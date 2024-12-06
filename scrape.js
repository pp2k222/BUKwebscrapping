const express = require("express");
const puppeteer = require("puppeteer");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // Obsługuje JSON w żądaniach POST

// Endpoint główny
app.get("/", (req, res) => {
  res.send("Serwer działa! Użyj endpointa POST /scrape, aby uruchomić skrypt.");
});

// Endpoint do uruchamiania scrapera
app.post("/scrape", async (req, res) => {
  const { ligaUrl, maksMecze } = req.body;

  if (!ligaUrl || !maksMecze) {
    return res.status(400).send({
      error: "Brakuje wymaganych danych wejściowych (ligaUrl, maksMecze).",
    });
  }

  console.log(`Rozpoczęto scrapowanie dla ligi: ${ligaUrl}`);
  console.log(`Maksymalna liczba meczów do przetworzenia: ${maksMecze}`);

  try {
    const mainBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const mainPage = await mainBrowser.newPage();
    await mainPage.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    try {
      await mainPage.goto(ligaUrl, { waitUntil: "networkidle0", timeout: 60000 });
      await mainPage.waitForSelector(".eventRowLink");
    } catch (err) {
      console.error("Błąd podczas ładowania strony ligi:", err.message);
      await mainBrowser.close();
      return res
        .status(500)
        .send({ error: "Nie udało się załadować strony ligi." });
    }

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
    const maxLinks = Math.min(maksMecze, links.length);

    for (const [index, link] of linksDetails.entries()) {
      if (index >= maxLinks) break;

      try {
        const clientBrowser = await puppeteer.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await clientBrowser.newPage();

        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        );

        try {
          await page.goto(link, { waitUntil: "networkidle0", timeout: 60000 });
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

          console.log(`Home Team: ${homeTeam}, Away Team: ${awayTeam}`);

          const eventsOneMatch = await page.evaluate(() => {
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
          console.warn(`Błąd przetwarzania szczegółów meczu: ${link}`, err.message);
        }
        await clientBrowser.close();
      } catch (err) {
        console.warn("Błąd inicjalizacji przeglądarki dla meczu:", err.message);
      }
    }

    await mainBrowser.close();

    console.log("Scrapowanie zakończone. Generowanie pliku Excel...");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Statystyki");

    worksheet.columns = [
      { header: "Statystyka", key: "label", width: 30 },
      { header: "Gospodarze", key: "home", width: 15 },
      { header: "Goście", key: "away", width: 15 },
      { header: "Mecz", key: "match", width: 30 },
      { header: "Czas", key: "time", width: 15 },
      { header: "Gracz", key: "player", width: 20 },
      { header: "Wydarzenie", key: "incidentTitle", width: 20 },
    ];

    // Przetwarzanie danych i zapisywanie ich do Excela
    events.forEach((event, index) => {
      event.forEach((data) => {
        worksheet.addRow({
          label: data.label || "",
          home: data.home || "",
          away: data.away || "",
          match: `Mecz ${index + 1}`,
          time: data.time || "",
          player: data.player || "",
          incidentTitle: data.incidentTitle || "",
        });
      });
    });

    const filePath = path.join(__dirname, "statystyki.xlsx");
    await workbook.xlsx.writeFile(filePath);

    console.log("Plik statystyki.xlsx został wygenerowany.");
    res.download(filePath, "statystyki.xlsx", (err) => {
      if (err) {
        console.error("Błąd podczas wysyłania pliku:", err.message);
      }

      // Usuwamy plik tymczasowy po wysłaniu
      fs.unlinkSync(filePath);
    });
  } catch (err) {
    console.error("Nieoczekiwany błąd:", err.message);
    res.status(500).send({ error: "Wystąpił błąd podczas scrapowania." });
  }
});

app.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
