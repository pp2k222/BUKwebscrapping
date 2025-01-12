const express = require("express");
const puppeteer = require("puppeteer");
const ExcelJS = require("exceljs");
const cors = require("cors");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

app.get("/scrape", async (req, res) => {
  const { leagueUrl, maxMatches, half } = req.query;
  const maxLinks = maxMatches ? parseInt(maxMatches, 10) : 100;

  let matchHalf = "0";
  if (half === "full") {
    matchHalf = "0";
  } else if (half === "first") {
    matchHalf = "1";
  } else if (half === "second") {
    matchHalf = "2";
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    console.log(`Przechodzę do URL: ${leagueUrl}`);
    await page.goto(leagueUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector(".eventRowLink");

    const links = await page.evaluate((matchHalf) => {
      return Array.from(document.querySelectorAll(".eventRowLink")).map(
        (a) => a.href + "/statystyki-meczu/" + matchHalf
      );
    }, matchHalf);

    const linksDetails = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".eventRowLink")).map(
        (a) => a.href + "/szczegoly-meczu"
      )
    );

    console.log(`Znaleziono ${links.length} linków do statystyk.`);
    console.log(`Znaleziono ${linksDetails.length} linków do szczegółów.`);

    const allData = [];
    const events = [];
    let count = 0;

    for (const link of linksDetails) {
      if (count >= maxLinks) break;

      const matchPage = await browser.newPage();
      try {
        console.log(`Przetwarzanie szczegółów meczu: ${link}`);
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
        
            let eventType = "Inne";
            if (eventTitle) {
              if (eventTitle.includes("yellowCard")) {
                eventType = "Żółta kartka";
              } else if (eventTitle.includes("var")) {
                eventType = "VAR";
              } else if (eventTitle.includes("redCard")) {
                eventType = "Czerwona kartka";
              } else if (eventTitle.includes("soccerBall")) {
                eventType = "Bramka";
              } else if (eventTitle.includes("substitution")) {
                eventType = "Zmiana";
              }
            }
        
            return {
              time: timeBox ? timeBox.innerText.trim() : null,
              player: playerName ? playerName.innerText.trim() : null,
              event: eventType, // Zmieniony typ wydarzenia
            };
          });
        });
        

        console.log(`Wydarzenia meczu:`, eventsOneMatch);
        events.push(eventsOneMatch);
        

        const scoreElements = Array.from(
          document.querySelectorAll(".smv__incidentAwayScore, .smv__incidentHomeScore")
        );
        scoreElements.forEach((scoreElement) => {
          const timeBox = scoreElement.closest('.smv__participantRow').querySelector(".smv__timeBox");
          const time = timeBox ? timeBox.innerText.trim() : "Nieznany czas";
      
          processedEvents.push({
            time: time,  
            player: "",  
            event: `Wynik: ${scoreElement.innerText.trim()}`,
          });
        });
      
        return processedEvents;
     
      
      events.push(eventsOneMatch);

      } catch (err) {
        console.warn(`Błąd podczas przetwarzania szczegółów meczu: ${err.message}`);
      } finally {
        await matchPage.close();
      }
      count++;
    }

    count = 0;
    for (const link of links) {
      if (count >= maxLinks) break;

      const statsPage = await browser.newPage();
      try {
        console.log(`Przetwarzanie statystyk meczu: ${link}`);
        await statsPage.goto(link, { waitUntil: "networkidle0", timeout: 60000 });
        await statsPage.waitForSelector("#detail");

        const [homeTeam, awayTeam, score] = await statsPage.evaluate(() => {
          const home = document
            .querySelector(".duelParticipant__home")
            ?.innerText.trim();
          const away = document
            .querySelector(".duelParticipant__away")
            ?.innerText.trim();
          const score = document
            .querySelector(".detailScore__wrapper")
            ?.innerText.trim();
          return [home, away, score];
        });

        console.log(`Mecz: ${homeTeam} vs ${awayTeam}, Wynik: ${score}`);

        const sectionData = await statsPage.evaluate(() => {
          const detailElement = document.getElementById("detail");
          const section = detailElement.querySelectorAll(":scope > .section")[0];
          return section.innerText.trim();
        });

        const cleanedData = sectionData
          .split("\n")
          .map((data) => data.trim())
          .filter((data) => data.length > 0);

        console.log(`Dane statystyczne (surowe):`, cleanedData);

        const matchStats = [];
        for (let i = 0; i < cleanedData.length; i += 3) {
          if (i + 2 < cleanedData.length) {
            matchStats.push({
              label: cleanedData[i + 1],
              home: cleanedData[i],
              away: cleanedData[i + 2],
              match: `${homeTeam} vs ${awayTeam} (${score})`,
            });
          }
        }

        console.log(`Dane statystyczne (przetworzone):`, matchStats);
        allData.push(matchStats);
      } catch (err) {
        console.warn("Błąd podczas pobierania danych statystycznych:", err.message);
      } finally {
        await statsPage.close();
      }
      count++;
    }

    await browser.close();

    // Łączenie danych statystyk i wydarzeń
    const mergedData = [];
    console.log("Scalanie danych...");
    for (let i = 0; i < allData.length; i++) {
      const data = allData[i];
      const details = events[i];
      let max = data.length;
      if (details.length > max) max = details.length;

      for (let j = 0; j < max; j++) {
        mergedData.push({
          label: data[j]?.label,
          home: data[j]?.home,
          away: data[j]?.away,
          match: data[j]?.match,
          time: details[j]?.time,
          player: details[j]?.player,
          event: details[j]?.event,
        });
      }
      mergedData.push({
        label: "",
        home: "",
        away: "",
        match: "",
        time: "",
        player: "",
        event: "",
      });
    }

    // Tworzenie pliku Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Statystyki");

    worksheet.columns = [
      { header: "Statystyka", key: "label", width: 30 },
      { header: "Gospodarze", key: "home", width: 15 },
      { header: "Goście", key: "away", width: 15 },
      { header: "Mecz", key: "match", width: 30 },
      { header: "Czas", key: "time", width: 15 },
      { header: "Gracz", key: "player", width: 30 },
      { header: "Wydarzenie", key: "event", width: 30 },
    ];

    mergedData.forEach((data) => {
      worksheet.addRow(data);
    });

    const filePath = "./statystyki.xlsx";
    await workbook.xlsx.writeFile(filePath);

    console.log("Dane zapisane do pliku:", filePath);
    res.download(filePath);
  } catch (err) {
    console.error("Błąd podczas przetwarzania:", err.message);
    res.status(500).send("Wystąpił błąd.");
  }
});




app.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});