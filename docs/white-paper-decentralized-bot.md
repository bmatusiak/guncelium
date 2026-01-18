
# White Paper: Decentralized Autonomous Bot (DAB) Protocol


## Collective Intelligence and Threshold Governance over Tor and Gun.io

**Version:** 1.1 **Author:** Distributed Systems Research Group **Status:** Proposal for Collective AI Management


### 1. Executive Summary

The Decentralized Autonomous Bot (DAB) Protocol defines a framework for creating autonomous software agents that are owned and operated by a collective rather than a single individual. By combining **Threshold Cryptography**, **Tor-based anonymity**, and **Gun.io graph synchronization**, a DAB can manage assets, process data, and execute complex AI tasks under a "Majority-Rules" governance model. This eliminates single points of failure and prevents any individual member of the collective from acting maliciously against the group's interests.


### 2. Theoretical Foundation: The Hive-Mind Bot

In traditional bot architectures, a single server holds a private key. In a DAB, the bot's "soul" (its private keys and logic) is fragmented across N participants.


#### 2.1 Threshold Security (m-of-n)

The bot's financial and administrative keys are managed via a **Threshold Signature Scheme (TSS)**.



* To spend funds or change the bot's core code, m out of n collective members must provide a cryptographic partial signature.
* **Security Result:** Even if a member's node is compromised or a member goes rogue, they cannot hijack the bot.


### 3. Technical Architecture


#### 3.1 The Shared Brain (Gun.io Graph)

Gun.io serves as the bot's persistent memory. The graph is structured to handle "Proposed Actions" and "Confirmed States."



* **Memory Nodes:** Store the bot's history and learned AI models.
* **Instruction Nodes:** Store current tasks (e.g., "Analyze Data Batch #502").
* **Consensus Nodes:** Store the "votes" from the collective.


#### 3.2 Communication (Tor)

The bot does not have a static IP. It exists as a swarm of peers on Tor. When the collective decides on an action, the instruction is gossiped through Gun.io over Tor, ensuring the bot's location remains hidden from external adversaries.


### 4. Escrow as a Governance Tool

In a DAB, escrow isn't just for payments—it's for **Task Validation**.



1. **Staking:** Members of the collective may be required to "stake" tokens to the bot's vault to participate in governance.
2. **The AI Escrow Loop:** * The DAB (Bot) initiates a task.
    * Funds are moved into a 2-of-3 Escrow between the **Bot**, the **Service Provider**, and a **Randomly Selected Member** of the collective.
    * This ensures the bot's resources are handled professionally, even if the bot is "buying" a service from one of its own members.


### 5. Collective Decision-Making Flow


#### Step 1: Proposal

A member posts a signed JSON object to the gun.get('bot').get('proposals') path. This object contains the AI task parameters and the proposed payout.


#### Step 2: Validation

Other members' local AI agents (running on their own Tor nodes) verify the proposal's parameters. If the proposal meets the collective's pre-set logic, the nodes auto-sign a "Yes" vote.


#### Step 3: Threshold Execution

Once the GUN node reflects that the threshold (e.g., 3/5) has been met:



* The TSS protocol generates a valid blockchain signature.
* The bot executes the action (e.g., sending a payment or releasing a data decryption key).


### 6. Use Cases



* **Privacy-Preserving Data Treasuries:** A group of hospitals collectively owning a bot that hires AI to find patterns in their shared (but private) data.
* **Community-Owned Trading Algos:** A collective managing a high-frequency trading bot where no single person can "rug-pull" the funds.
* **Decentralized Oracles:** The bot acts as a source of truth for clearweb-to-Tor data feeds, verified by a quorum of peers.


### 7. Conclusion

The DAB Protocol moves decentralized technology from "passive storage" (databases) to "active agency" (bots). By grounding this agency in collective threshold governance, we create a new class of digital entity that is resilient, anonymous, and incorruptible.
