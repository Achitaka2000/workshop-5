import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // node id
  N: number, // number of nodes
  F: number, // number of faulty nodes
  initialValue: Value, // initial value
  isFaulty: boolean, // indicates if the node is faulty
  nodesAreReady: () => boolean, // function to check if all nodes are ready
  setNodeIsReady: (index: number) => void // function to set the node as ready
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  // Initialization
  let nodeState: NodeState = {
    killed: isFaulty,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Endpoint to check the status of the node
  node.get("/status", (req, res) => {
    if (isFaulty === true) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  // Endpoint to start the consensus algorithm
  node.get("/start", async (req, res) => {
    // Wait until all nodes are ready
    while (!nodesAreReady()) {
      await delay(100);
    }

    if (!isFaulty) {
      // Initialize the node state
      nodeState.k = 1;
      nodeState.x = initialValue;
      nodeState.decided = false;

      // Send a proposal message to all nodes
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${3000 + i}/message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            k: nodeState.k,
            x: nodeState.x,
            messageType: "P", // P for proposal
          }),
        });
      }
    } else {
      // If the node is faulty, initialize the state accordingly
      nodeState.decided = null;
      nodeState.x = null;
      nodeState.k = null;
    }
    res.status(200).send("started");
  });

  // Endpoint to stop the node
  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    res.status(200).send("killed");
  });

  // Endpoint to get the current state of the node
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

  // Endpoint to receive messages from other nodes
  node.post(
    "/message",
    async (req: Request<any, any, any, any>, res: Response<any>) => {
      let { k, x, messageType } = req.body;
      if (!nodeState.killed && !isFaulty) {
        if (messageType == "P") {
          // Process a proposal message
          if (!proposals.has(k)) proposals.set(k, []);
          proposals.get(k)!.push(x);
          const proposalList = proposals.get(k);
          if (proposalList && proposalList.length >= N - F) {
            const countNo = proposalList.filter((x) => x == 0).length;
            const countYes = proposalList.filter((x) => x == 1).length;
            let decisionValue =
              countNo > N / 2 ? 0 : countYes > N / 2 ? 1 : "?";
            // Send a vote message to all nodes
            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ k, x: decisionValue, messageType: "V" }),
              });
            }
          }
        } else if (messageType == "V") {
          // Process a vote message
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
              // Send a proposal message to all nodes
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