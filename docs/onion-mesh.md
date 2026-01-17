

# The Onion-Mesh Protocol


### A Hybrid Transport for Decentralized Data Synchronization

**Version:** 1.2

**Status:** Draft / Technical Proposal (Agnostic Framework)


## 1. Abstract

Decentralized mesh networks often struggle with the **"Discovery Problem"**—how two peers find each other without a central authority—and the **"Traversal Problem"**—how to establish connections through restrictive Network Address Translation (NAT) environments.

This paper proposes the **Onion-Mesh Protocol**, an **agnostic, multi-tier architecture** that leverages the **Tor Network** for secure, anonymous discovery and signaling, and **WebRTC** for high-performance, peer-to-peer (P2P) data synchronization. By utilizing **Gun.eco** as a system-agnostic conflict-free replicated data type (CRDT) engine, we create a resilient mesh capable of operating across any platform, device, or operating system while maintaining eventual consistency across a global graph.


## 2. Defining "Agnostic" in the Onion-Mesh Context

In this protocol, "Agnostic" refers to **functional independence**. The system is designed to operate without reliance on specific vendors, hardware architectures, or software ecosystems. It is broken down into four core dimensions:


### 2.1 Platform-Agnostic (Runtime Independence)

The protocol logic does not care about the execution environment.



* It functions identically whether running in a **Web Browser** (via WebAssembly/Tor Bridges), a **Mobile App** (React Native/Flutter), or a **System Service** (Node.js/Go/Rust).
* The API surface remains consistent, allowing developers to write application logic once and deploy it across the entire digital spectrum.


### 2.2 Device-Agnostic (Hardware Independence)

The mesh treats a $10,000$ server and a $10$ IoT sensor as equal peers.



* It does not assume the presence of a specific CPU architecture (x86 vs ARM) or a minimum power profile.
* Instead, it categorizes devices by **functional roles** (Transient vs. Archival) based on their current resource availability rather than their hardware label.


### 2.3 System-Agnostic (OS Independence)

The protocol relies on universal open standards rather than proprietary Operating System APIs.



* By using **Onion Routing (Tor)** and **WebRTC/UDP**, it bypasses OS-level networking differences.
* Whether a device is running Linux, Windows, macOS, Android, or iOS, the "handshake" and "wire" remain compatible.


### 2.4 Transport-Agnostic (Connectivity Independence)

The "Graph Layer" (Gun.eco) is decoupled from the "Wire Layer."



* The application doesn't need to know if it's talking over a **Tor Hidden Service**, a **WebRTC DataChannel**, or a **Local LAN**.
* The protocol dynamically switches between transports based on the environment, treating the physical connection as a "black box" that simply moves bytes from $A$ to $B$.


## 3. The Architecture Layers


### 3.1 Layer 1: The Control Plane (Tor/DHT)

The Control Plane handles peer-to-peer discovery and identity verification.



* **Self-Sovereign Identity:** Nodes use **Onion Addresses** as globally unique, location-independent identifiers (URIs) that bypass DNS.
* **Agnostic Signaling:** Tor acts as a secure, firewall-agnostic channel for the WebRTC handshake, ensuring signaling packets reach their destination regardless of local network restrictions.


#### 3.1.1 Bootstrap Onion (Rendezvous) and Trust Model

This protocol may optionally use a **shared bootstrap Onion Address** as an **entry-point rendezvous**. The purpose of this onion is **availability and discovery**, not authority.

Key properties:

* **Transport-only:** The bootstrap onion is a place to *meet* (initial dial-out / directory / signaling). It must not be treated as a trusted source of truth.
* **Untrusted by design:** Any node may host or impersonate the shared bootstrap onion. Therefore, the bootstrap endpoint is assumed to be **malicious or compromised**.
* **Authenticity lives above Tor:** Identity and authorization are enforced at the **application layer** (e.g. Gun SEA signatures), not by the bootstrap onion itself.

Why allow a “shared key” bootstrap?

* **Redundancy:** A shared bootstrap onion can be hosted by multiple backbone/relay nodes without requiring centralized DNS or a single always-on server.
* **Censorship resistance:** The network can keep a known entry-point even if individual hosts churn.

Security implication:

* **The onion address does not imply trust** when its private key is intentionally shared. It only implies *reachability* to *some* host currently publishing that descriptor.


### 3.2 Layer 2: The Data Plane (WebRTC/UDP)

The Data Plane is the "high-speed" tier.



* **Latency Reduction:** Moves traffic from high-latency Tor circuits to direct UDP hole-punched links.
* **Cross-Environment Compatibility:** WebRTC is the ideal agnostic transport as it is natively supported in browsers and cross-platform binaries.


### 3.3 Layer 3: The Graph Layer (Gun.eco)

Gun.eco provides the logic for data distribution and conflict resolution.



* **Eventual Consistency:** Merges data across unstable links, ensuring synchronization even in intermittent "offline-first" scenarios.


## 4. The Synchronization Workflow



1. **Bootstrapping:** The client joins via an entry-point Onion Address and publishes its capability profile to the mesh/peers graph.
2. **Discovery:** Peers "map" over the directory and initiate a secondary transport-agnostic connection to verify the link.
3. **The Handshake:** Peers exchange WebRTC capabilities via the secure Tor channel.
4. **The Handover:** The DataPlane (WebRTC) is prioritized for speed, while the ControlPlane (Tor TCP) remains a **guaranteed fallback** transport.


### 4.1 Practical Bootstrapping Rules (Anti-Poisoning)

Because the bootstrap onion is untrusted, nodes must validate information received during discovery.

Recommended rules:

* **Signed advertisements:** Peer records (onion IDs, endpoints, capabilities) are written as signed objects (e.g. SEA) so readers can verify authorship.
* **No unsigned promotion:** Do not auto-connect to newly discovered peers unless their advertisements are properly signed and meet local policy.
* **Treat discovery as hints:** The bootstrap and directory data are *suggestions*; the node must independently verify the peer connection.
* **Separate identity from transport:** A node’s long-term identity key should be independent from its current network endpoint(s).


## 5. Node Personas (Functional Roles)



* **Transient Nodes (Edge):** Intermittent connectivity (phones, sensors).
* **Archival Nodes (Backbone):** High-availability systems providing persistent storage and TURN (relay) services.
* **Relay Nodes:** High-bandwidth nodes facilitating discovery and the initial Tor handshake.


## 6. Security & Privacy Considerations



1. **Application Layer:** SEA provides end-to-end encryption of the graph data.
2. **Transport Layer:** Streams are encrypted via DTLS/SRTP (WebRTC) or TLS (Tor).
3. **Network Layer:** Multi-hop onion routing masks the physical location (IP) of the control plane.


### 6.1 Bootstrap Onion Threat Model

When a shared bootstrap onion key is distributed with clients, assume:

* **Impersonation is possible:** Anyone can host the bootstrap onion.
* **Directory poisoning is expected:** Attackers can publish fake peers/capabilities.
* **Availability attacks will occur:** Some bootstrap replicas may be down, slow, or maliciously rate-limited.

Mitigations:

* **Application-layer signatures are mandatory** for any discovery record that influences routing or trust.
* **Least-trust defaults:** New peers start in a “probation” state until verified.
* **Multiple entry points:** Maintain a small list of bootstrap onions (or rotate) to reduce single-point DoS.
* **Metadata awareness:** Tor protects IPs, not necessarily all metadata (timing/volume). Keep discovery payloads minimal.


## 7. Conclusion

The Onion-Mesh Protocol empowers a truly unified decentralized web where every device is a first-class citizen. By maintaining absolute agnosticism, the protocol ensures it remains resilient to platform shifts and hardware evolution, providing a permanent foundation for censorship-resistant data exchange.