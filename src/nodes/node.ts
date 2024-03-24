import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // node id
  N: number, // number of node
  F: number, // nb faulty nodes
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initialisation
  let nodeState: NodeState = {
    killed: isFaulty,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  node.get("/status", (req, res) => {
    if (isFaulty === true) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(100);
    }

    if (!isFaulty) {
      nodeState.k = 1;
      nodeState.x = initialValue;
      nodeState.decided = false;

      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${3000 + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            k: nodeState.k,
            x: nodeState.x,
            messageType: "P", // P pour proposition
          }),
        });
      }
    } else {
      nodeState.decided = null;
      nodeState.x = null;
      nodeState.k = null;
    }
    res.status(200).send("started");
  });

  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    res.status(200).send("killed");
  });

  node.get("/getState", (req, res) => {
    if (isFaulty) {
      res.send({
        killed: nodeState.killed,
        decided: null,
        x: null,
        k: null,
      });
    } else {
      res.send(nodeState);
    }
  });

  //message

  node.post(
    "/message",
    async (req: Request<any, any, any, any>, res: Response<any>) => {
      let { k, x, messageType } = req.body;
      if (!nodeState.killed && !isFaulty) {
        if (messageType == "P") {
          if (!proposals.has(k)) proposals.set(k, []);
          proposals.get(k)!.push(x);
          const proposalList = proposals.get(k);
          if (proposalList && proposalList.length >= N - F) {
            const countNo = proposalList.filter((x) => x == 0).length; // Remplacer "CN" par "countNo"
            const countYes = proposalList.filter((x) => x == 1).length; // Remplacer "CY" par "countYes"
            let decisionValue =
              countNo > N / 2 ? 0 : countYes > N / 2 ? 1 : "?"; // Renommer "x" par "decisionValue" pour cette opération
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ k, x: decisionValue, messageType: "V" }), // Remplacer "type" par "messageType" et "2V" par "V" pour Vote
              });
            }
          }
        } else if (messageType == "V") {
          if (!votes.has(k)) votes.set(k, []);
          votes.get(k)!.push(x);
          const voteList = votes.get(k);
          if (voteList && voteList.length >= N - F) {
            const countNo = voteList.filter((x) => x == 0).length;
            const countYes = voteList.filter((x) => x == 1).length;
            if (countNo >= F + 1) {
              nodeState.x = 0;
              nodeState.decided = true;
            } else if (countYes >= F + 1) {
              nodeState.x = 1;
              nodeState.decided = true;
            } else {
              nodeState.x =
                countNo + countYes > 0 && countNo > countYes
                  ? 0
                  : countNo + countYes > 0 && countNo < countYes
                  ? 1
                  : Math.random() > 0.5
                  ? 0
                  : 1;
              if (nodeState.k != null) nodeState.k += 1;
              for (let i = 0; i < N; i++) {
                fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    k: nodeState.k,
                    x: nodeState.x,
                    messageType: "P",
                  }),
                });
              }
            }
          }
        }
      }
      res.status(200).send("success");
    }
  );

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });

  return server;
}