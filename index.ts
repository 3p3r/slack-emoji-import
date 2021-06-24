import axios from "axios";
import { createWriteStream, promises as fs } from "fs";
import { URL } from "url";
import { Page } from "puppeteer";
import { boolean } from "boolean";
import * as puppeteer from "puppeteer";
import * as prompts from "prompts";
import * as yaml from "js-yaml";
import * as path from "path";
import * as tmp from "tmp";

prompts.override({
  yaml: process.env["SLACK_EMOJI_IMPORT_YAML"],
  host: process.env["SLACK_EMOJI_IMPORT_HOST"],
  email: process.env["SLACK_EMOJI_IMPORT_USER"],
  password: process.env["SLACK_EMOJI_IMPORT_PASS"],
  show: boolean(process.env["SLACK_EMOJI_IMPORT_SHOW"]),
});

tmp.setGracefulCleanup();

interface Emoji {
  name: string;
  src: string;
}

interface EmojiPack {
  title: string;
  emojis: Emoji[];
}

interface UserInput {
  yaml: string;
  host: string;
  email: string;
  password: string;
  show: boolean;
}

start();

async function start() {
  const userInput = await getUserInput();

  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: !userInput.show,
    defaultViewport: { width: 1200, height: 1000 },
  });

  console.log("Creating an incognito browser context...");
  const browserCtx = await browser.createIncognitoBrowserContext();

  console.log("Opening a new tab in our browser context...");
  const page = await browserCtx.newPage();

  console.log("logging in...");
  await login(page, userInput);

  console.log("loading emoji YAML file...");
  const emojiPack = await loadEmojiPack(userInput);

  for (let emoji of emojiPack.emojis) {
    let imagePath: string;

    if (emoji.src.includes("://")) {
      console.log(`downloading ${emoji.name}...`);
      imagePath = await downloadImage(emoji.src);
      console.log(`downloaded  ${emoji.name}.`);
    } else {
      imagePath = emoji.src;
      console.log(`using local file for ${emoji.name}.`);
    }

    console.log(`uploading ${emoji.name}...`);
    await upload(page, imagePath, emoji.name);
    await sleep(100);
    console.log(`uploaded  ${emoji.name}.`);
  }

  console.log(`Uploaded ${emojiPack.emojis.length} emojis.`);
  await browser.close();
}

async function getUserInput() {
  const results = await prompts([
    {
      type: "text",
      name: "yaml",
      message: "Emojipacks YAML Path?",
      hint: "You can get some from https://github.com/lambtron/emojipacks",
    },
    {
      type: "text",
      name: "host",
      message: "Slack Host?",
    },
    {
      type: "text",
      name: "email",
      message: "Slack Login Email?",
    },
    {
      type: "text",
      name: "password",
      message: "Slack Password?",
      hint: "If you use third party auth such as Google, reset your password and Slack will give you a physical password",
    },
    {
      type: "confirm",
      name: "show",
      message: "Show browser?",
      initial: false,
    },
  ]);

  return results as UserInput;
}

async function login(page: Page, { host, password, email }: UserInput) {
  const url = `https://${host}.slack.com/?redir=%2Fcustomize%2Femoji`;
  await page.goto(url);

  const emailInputSelector = "#signin_form input[type=email]";
  await page.waitForSelector(emailInputSelector, { visible: true });

  await sleep(500);
  await setInputElementValue(page, emailInputSelector, email);

  const passwordInputSelector = "#signin_form input[type=password]";
  await setInputElementValue(page, passwordInputSelector, password);

  const signinButtonElement = await page.$("#signin_form #signin_btn");
  await signinButtonElement.click();

  await page.waitForSelector(emailInputSelector, { hidden: true });
}

async function loadEmojiPack(userInput: UserInput) {
  const yamlPath = userInput.yaml;
  const yamlContent = await fs.readFile(yamlPath, { encoding: "utf-8" });
  const yamlParsed = yaml.load(yamlContent);
  return yamlParsed as EmojiPack;
}

async function downloadImage(url: string) {
  const { pathname } = new URL(url);
  const { ext } = path.parse(pathname);
  const tempImage = tmp.tmpNameSync({ postfix: ext });
  const writer = createWriteStream(tempImage);
  const response = await axios.get(url, { responseType: "stream" });

  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return tempImage;
}

async function upload(page: Page, imagePath: string, name: string) {
  await page.evaluate(async () => {
    let addEmojiButtonSelector = ".p-customize_emoji_wrapper__custom_button";
    // Wait for emoji button to appear
    while (!document.querySelector(addEmojiButtonSelector)) {
      await new Promise((r) => setTimeout(r, 500));
    }
    let buttonClassName = addEmojiButtonSelector.substring(
      1,
      addEmojiButtonSelector.length
    );
    const addEmojiButtonElement = <HTMLElement>(
      document.getElementsByClassName(buttonClassName)[0]
    );

    if (!addEmojiButtonElement) throw new Error("Add Emoji Button not found");

    addEmojiButtonElement.click();
  });

  const fileInputElement = await page.waitForSelector("input#emojiimg");
  await fileInputElement.uploadFile(imagePath);

  await setInputElementValue(page, "#emojiname", name);

  const saveEmojiButtonSelector =
    ".c-sk-modal_footer_actions .c-button--primary";
  const saveEmojiButtonElement = await page.waitForSelector(
    saveEmojiButtonSelector
  );
  await saveEmojiButtonElement.click();

  await page.waitForSelector(saveEmojiButtonSelector, { hidden: true });
}

async function setInputElementValue(
  page: Page,
  querySelector: string,
  value: string
) {
  const element = await page.waitForSelector(querySelector);
  // clear existing value
  await page.focus(querySelector);
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await page.keyboard.press("Backspace");
  // enter new value
  await element.type(value, { delay: 20 });
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
