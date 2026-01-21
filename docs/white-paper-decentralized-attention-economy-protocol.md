
# White Paper: Decentralized Attention Economy Protocol (DAEP)


## Privacy-Preserving Ad Distribution and Direct-to-User Compensation

**Version:** 1.1

**Status:** Technical Specification for Opt-In Advertising


### 1. Abstract

The Decentralized Attention Economy Protocol (DAEP) introduces a peer-to-peer advertising model that eliminates intermediaries. In the current ecosystem, 60% of ad spend is lost to middlemen and fraud. DAEP utilizes **Gun.io** for decentralized ad matching, **Tor** for identity masking, and **Escrow** for the automated payout of "Attention Credits" directly to users. In this system, users are not the product; they are the primary service providers.


### 2. The Problem: The "Attention Tax"

Modern digital advertising relies on non-consensual tracking and data harvesting.



* **Ad Fraud:** Bot traffic drains advertiser budgets.
* **Privacy Erosion:** Third-party cookies leak sensitive user behavior.
* **Value Gap:** Users provide the attention that makes the ad valuable, but receive $0$ in direct compensation.


### 3. Core Protocol Components


#### 3.1 The Opt-In Registry (GUN Graph)

Unlike centralized ad servers, DAEP uses a distributed graph where users publish **Anonymized Interest Profiles**.



* Users generate a SEA-protected profile (e.g., "Interests: Machine Learning, Tor, Privacy Tools").
* This profile is stored locally and only "signals" to the network that it is available for specific ad categories.
* No personal identifiers (IPs, names, emails) are ever shared.


#### 3.2 The** Multi-Stage** Attention Escrow

Every advertisement campaign is backed by a **Pre-Funded Escrow Vault**.



* When an Advertiser creates a campaign, they lock a total budget ($T$) into a multi-sig contract.
* The contract logic facilitates a dual-payout structure:
    * **Engagement Payout (**$X$**):** Released immediately upon valid Proof-of-Attention (Click/View).
    * **Conversion Payout (**$Y$**):** Released upon valid Proof-of-Purchase (Conversion).


### 4. Technical Workflow


#### Phase 1: Local Ad Matching

Instead of a server choosing what you see, the **Matching Algorithm runs on the User's device**.



1. The user's node pulls the latest "Ad Catalog" from the GUN mesh.
2. The device locally compares the catalog against the user's private interest profile.
3. If a match is found, the ad is queued for a "Consensual Display."


#### Phase 2: The Opt-In Handshake

The user receives a notification: "An ad for $Privacy\ Tool\ X$ is available. View for 50 Credits?"



* If the user ignores it: Nothing happens. No data is leaked.
* If the user clicks "View": A **Proof-of-Attention (PoA)** session begins.


#### Phase 3: Proof-of-Attention (PoA)** & Immediate Payout**

To prevent bot fraud, DAEP requires a cryptographic proof that a human interacted with the ad.



* **Engagement Check:** Verification of a click or view duration.
* Immediate Reward: Upon a valid click, the Escrow releases the "Engagement Payout" ($X$) to the \
$$User\_Wallet$$


#### **Phase 4: Proof-of-Purchase (PoP) & Conversion Bonus**

If the user proceeds to make a purchase from the advertiser:



1. A **Proof-of-Purchase** (a signed receipt hash) is generated.
2. The Arbitrator verifies that the purchase originated from the initial ad engagement stored in the GUN graph.
3. The Escrow releases the "Conversion Payout" ($Y$)—essentially a direct-to-user commission—to the \
$$User\_Wallet$$


### 5. Economic Model: The Value Shift

The transition from legacy advertising to DAEP represents a fundamental shift in how digital value is distributed:



* **Data Ownership:** While legacy systems allow advertisers and corporations like Google to own and store user data, DAEP ensures the user owns all their data locally on their own device.
* **Payment Architecture:** Traditional flows move funds from the Advertiser to a platform middleman and finally to a publisher. In DAEP, the Advertiser pays the User directly.
* **Multi-Tiered Rewards:** Users earn value both for their **Attention** (viewing/clicking) and their **Action** (purchasing), effectively receiving a rebate on every product bought through the network.
* **Targeting Methodology:** Legacy targeting relies on invasive, surveillance-based tracking. DAEP utilizes user-selected, opt-in interests that never leave the local environment.
* **Systemic Trust:** Legacy systems suffer from low trust due to rampant bot fraud; DAEP provides high trust through immutable cryptographic Proof-of-Attention.


### 6. Security & Privacy


#### 6.1 Tor Anonymity

Advertisers can see that *someone* viewed their ad and that a payout was triggered, but they cannot see the IP address or identity of the viewer because the entire communication is routed through Tor hidden services.


#### 6.2 Preventing "Click-Farms"

The "Collective Bot" validators use **Proof-of-Personhood** or **Stake-Based limits** to ensure a single node isn't "viewing" 1,000 ads per minute to drain advertiser budgets.


### 7. Conclusion

DAEP turns "Advertising" into a "Bounty" system. By moving the value from the platforms to the users, we incentivize a cleaner, more respectful internet. Users are finally compensated for the most valuable resource they possess: their **Attention**, and they are further rewarded for their **Economic Participation**.
