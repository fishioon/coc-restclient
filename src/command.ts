import { workspace, window, Neovim } from "coc.nvim";
import { HttpTextParser } from "./http/textParser";
import { HttpRequestParser } from "./http/requestParser";
import { HttpClient } from "./http/httpClient";

async function bufwinnr(name: string): Promise<number> {
  const buf = await workspace.nvim.call("bufnr", name);
  if (buf == -1) return -1;
  return await workspace.nvim.call("bufwinnr", buf);
}

export const requestHandler = async () => {
  // get config
  const config = workspace.getConfiguration("rest-client");

  // get current doco text
  const document = await workspace.document;
  const rawText = document.textDocument.getText();

  // get current cursor position
  const { position } = await workspace.getCurrentState();

  const parser = new HttpTextParser();

  const selectedRequest = parser.getRequest(rawText, position.line);
  if (!selectedRequest) {
    return;
  }

  const { text, name, warnBeforeSend } = selectedRequest;

  if (warnBeforeSend) {
    const warning = name
      ? `Are you sure you want to send the request "${name}"?`
      : "Are you sure you want to send this request?";
    const userConfirmed = await window.showPrompt(warning);
    if (!userConfirmed) {
      return;
    }
  }

  // TODO: Support different request parsers
  const httpRequest = await new HttpRequestParser(
    text,
    config
  ).parseHttpRequest(name);

  const channel = window.createOutputChannel(name || "rest-client");
  if ((await bufwinnr(`output:///${channel.name}`)) === -1) {
    channel.show(false);
  } else {
    channel.clear(0);
  }

  const httpClient = new HttpClient(config, document);
  try {
    channel.append(`${httpRequest.method} ${httpRequest.url}\n\n`);
    const response = await httpClient.send(httpRequest);

    // check cancel
    if (httpRequest.isCancelled) {
      return;
    }

    channel.append(
      `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\n\n`
    );

    if (config.showHeaders) {
      channel.append(JSON.stringify(response.headers, null, 2));
      channel.append(`\n\n`);
    }

    try {
      channel.append(JSON.stringify(JSON.parse(response.body), null, 2));
    } catch (error) {
      channel.append(response.body);
    }

    // console.log(response);
  } catch (error: any) {
    if (error.code === "ETIMEDOUT") {
      error.message = `Please check your networking connectivity and your time out in ${config.timeoutInMilliseconds}ms according to your configuration 'rest-client.timeoutinmilliseconds'. Details: ${error}. `;
    } else if (error.code === "ECONNREFUSED") {
      error.message = `Connection is being rejected. The service isn’t running on the server, or incorrect proxy settings in vscode, or a firewall is blocking requests. Details: ${error}.`;
    } else if (error.code === "ENETUNREACH") {
      error.message = `You don't seem to be connected to a network. Details: ${error}`;
    } else if (error.code === "ENOTFOUND") {
      error.message = `Address not found ${httpRequest.url}. Details: ${error}`;
    }
    window.showErrorMessage(error.message);
  }
};
