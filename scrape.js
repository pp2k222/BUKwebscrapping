const MaksymalnaLiczbaMeczy = 100;
const LinkDoLigi =
  "https://www.flashscore.pl/pilka-nozna/anglia/premier-league/wyniki/";
const express = require("express");
const puppeteer = require("puppeteer");
const ExcelJS = require("exceljs");
const PORT = process.env.PORT || 3000;  // Jeśli PORT nie jest ustawiony, używaj 3000 (lokalnie)
const app = express();
app.get("/", (req, res) => {
  res.send("Hello, world!");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
(async () => {
  const mainBrowser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const mainPage = await mainBrowser.newPage();
  await mainPage.goto(LinkDoLigi);
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

      console.log(`Home Team: ${homeTeam}, Away Team: ${awayTeam}`);
      //console.log(link);

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
          // Określenie typu zdarzenia
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
  count = 0;
  for (const link of links) {
    if (count >= maxLinks) break;

    const clientBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await clientBrowser.newPage();
    await page.goto(link);
    try {
      await page.waitForSelector("#detail");

      const [homeTeam, awayTeam, score] = await page.evaluate(() => {
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

      console.log(`Home Team: ${homeTeam}, Away Team: ${awayTeam}`);

      sectionData = await page.evaluate(() => {
        const detailElement = document.getElementById("detail");
        const section = detailElement.querySelectorAll(":scope > .section")[0];
        return section.innerText.trim();
      });
      //console.log(sectionData)
      if (sectionData.length > 0) {
        console.log(`Pobrano dane z ${link}`);

        const cleanedData = sectionData
          .split("\n")
          .map((data) => data.trim())
          .filter((data) => data.length > 0);
        let onematch = [];
        for (let i = 0; i < cleanedData.length; i += 3) {
          if (i + 2 < cleanedData.length) {
            const homeValue = cleanedData[i];
            const label = cleanedData[i + 1];
            const awayValue = cleanedData[i + 2];
            console.log(
              `Pobieram: ${label} - Gospodarze: ${homeValue}, Goście: ${awayValue}`
            );

            onematch.push({
              label: label,
              home: homeValue,
              away: awayValue,
              match: `${homeTeam} vs ${awayTeam} ${score.replace(
                /\r?\n|\r/g,
                " "
              )}`,
            });
          }
        }
        allData.push(onematch);
      } else {
        console.log(`Brak danych dla meczu ${homeTeam} vs ${awayTeam}`);
      }
    } catch (err) {
      console.warn("Element #detail nie został znaleziony.");
    }

    count++;
    await clientBrowser.close();
  }

  await mainBrowser.close();
  console.log(events.length);
  console.log(allData.length);
  const mergedData = [];
  let mergedObject;
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
        event: details[j]?.incidentTitle,
      });
    }
  }
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
  //console.log(mergedData);

  mergedData.forEach((data) => {
    worksheet.addRow(data);
  });

  await workbook.xlsx.writeFile("statystyki.xlsx");
  console.log("Dane zostały zapisane do pliku statystyki.xlsx");
})();
