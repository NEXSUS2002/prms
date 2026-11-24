// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PRMS registry, consent and audit contract
/// @notice Holds who may take part (hospitals and practitioners), who may read a patient's record
///         (consent and emergency overrides) and the hashes that make off-chain records tamper-evident.
///         No clinical data is stored here.
contract PRMSRegistry {
    uint64 public constant CONSENT_PERIOD = 24 hours;
    uint64 public constant EMERGENCY_PERIOD = 1 hours;

    address public registrar; // admits and suspends hospitals
    address public relayer;   // the API server's wallet: anchors record hashes and laboratory tokens

    struct Hospital {
        address admin;
        bool exists;
        bool active;
    }

    struct Practitioner {
        string licenseNo;
        bool exists;
        bytes32 suspendedBy; // hospital whose administrator suspended the practitioner; zero when not suspended
    }

    struct LabToken {
        bytes32 departmentId;
        uint64 expiresAt;
        bool exists;
        bool used;
    }

    mapping(bytes32 => Hospital) public hospitals;                      // hospital id => hospital
    mapping(address => bytes32) public hospitalOfAdmin;                 // admin wallet => hospital id
    mapping(address => Practitioner) private practitioners;
    mapping(address => mapping(bytes32 => bool)) public affiliatedWith; // practitioner => hospital => verified there
    mapping(address => mapping(address => uint64)) public consentExpiry;   // patient => practitioner => expiry
    mapping(address => mapping(address => uint64)) public overrideExpiry;  // patient => practitioner => expiry
    mapping(bytes32 => bytes32) public recordHash;                      // record id => hash (write once)
    mapping(bytes32 => LabToken) public labTokens;                      // child token hash => token

    event RegistrarChanged(address indexed registrar);
    event RelayerChanged(address indexed relayer);
    event HospitalRegistered(bytes32 indexed hospitalId, address indexed admin);
    event HospitalStatusChanged(bytes32 indexed hospitalId, bool active);
    event PractitionerVerified(address indexed practitioner, bytes32 indexed hospitalId, string licenseNo);
    event PractitionerSuspended(address indexed practitioner, bytes32 indexed hospitalId);
    event AccessGranted(address indexed patient, address indexed practitioner, uint64 expiresAt);
    event AccessRevoked(address indexed patient, address indexed practitioner);
    event EmergencyAccessLogged(
        address indexed practitioner,
        string licenseNo,
        address indexed patient,
        bytes32 indexed hospitalId,
        uint256 timestamp
    );
    event RecordAnchored(bytes32 indexed recordId, bytes32 recordHash, bytes32 indexed hospitalId);
    event AddendumAnchored(bytes32 indexed originalRecordId, bytes32 indexed addendumRecordId, bytes32 recordHash);
    event TokenRegistered(bytes32 indexed tokenHash, bytes32 indexed departmentId, uint64 expiresAt);
    event ResultAnchored(bytes32 indexed tokenHash, bytes32 resultHash);

    modifier onlyRegistrar() {
        require(msg.sender == registrar, "Only the registrar");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "Only the relayer");
        _;
    }

    constructor(address relayer_) {
        registrar = msg.sender;
        relayer = relayer_;
        emit RegistrarChanged(msg.sender);
        emit RelayerChanged(relayer_);
    }

    // ------------------------------------------------------------------ registrar

    function transferRegistrar(address next) external onlyRegistrar {
        require(next != address(0), "Zero address");
        registrar = next;
        emit RegistrarChanged(next);
    }

    function setRelayer(address next) external onlyRegistrar {
        relayer = next;
        emit RelayerChanged(next);
    }

    /// @notice Admit a hospital and bind it to the wallet of its administrator.
    function registerHospital(bytes32 hospitalId, address admin) external onlyRegistrar {
        require(hospitalId != bytes32(0) && admin != address(0), "Invalid hospital");
        require(!hospitals[hospitalId].exists, "Hospital already registered");
        require(hospitalOfAdmin[admin] == bytes32(0), "Admin wallet already bound to a hospital");
        hospitals[hospitalId] = Hospital({admin: admin, exists: true, active: true});
        hospitalOfAdmin[admin] = hospitalId;
        emit HospitalRegistered(hospitalId, admin);
    }

    function setHospitalActive(bytes32 hospitalId, bool active) external onlyRegistrar {
        require(hospitals[hospitalId].exists, "Unknown hospital");
        hospitals[hospitalId].active = active;
        emit HospitalStatusChanged(hospitalId, active);
    }

    // ------------------------------------------------------------------ hospital administrator

    function _adminHospital() private view returns (bytes32 hospitalId) {
        hospitalId = hospitalOfAdmin[msg.sender];
        require(hospitalId != bytes32(0), "Not a hospital administrator");
        require(hospitals[hospitalId].active, "Hospital is suspended");
    }

    /// @notice Verify a practitioner at the caller's own hospital. Also lifts a suspension placed by this hospital.
    function verifyPractitioner(address practitioner, string calldata licenseNo) external {
        bytes32 hospitalId = _adminHospital();
        require(practitioner != address(0), "Zero address");
        require(bytes(licenseNo).length > 0, "Licence number required");
        Practitioner storage p = practitioners[practitioner];
        require(p.suspendedBy == bytes32(0) || p.suspendedBy == hospitalId, "Suspended by another hospital");
        p.exists = true;
        p.licenseNo = licenseNo;
        p.suspendedBy = bytes32(0);
        affiliatedWith[practitioner][hospitalId] = true;
        emit PractitionerVerified(practitioner, hospitalId, licenseNo);
    }

    /// @notice Suspend a practitioner of the caller's own hospital. The suspension applies at every hospital.
    function suspendPractitioner(address practitioner) external {
        bytes32 hospitalId = _adminHospital();
        require(affiliatedWith[practitioner][hospitalId], "Not a practitioner of this hospital");
        practitioners[practitioner].suspendedBy = hospitalId;
        emit PractitionerSuspended(practitioner, hospitalId);
    }

    // ------------------------------------------------------------------ views on the registry

    function licenseOf(address practitioner) external view returns (string memory) {
        return practitioners[practitioner].licenseNo;
    }

    function isSuspended(address practitioner) external view returns (bool) {
        return practitioners[practitioner].suspendedBy != bytes32(0);
    }

    /// @notice True when the practitioner is verified at the given hospital, is not suspended, and the hospital is active.
    function isVerifiedAt(address practitioner, bytes32 hospitalId) public view returns (bool) {
        Practitioner storage p = practitioners[practitioner];
        return p.exists && p.suspendedBy == bytes32(0) && affiliatedWith[practitioner][hospitalId]
            && hospitals[hospitalId].active;
    }

    // ------------------------------------------------------------------ patient consent

    /// @notice Called by the patient: let a verified practitioner read the record for 24 hours.
    function grantAccess(address practitioner) external {
        Practitioner storage p = practitioners[practitioner];
        require(p.exists && p.suspendedBy == bytes32(0), "Unauthorised practitioner");
        uint64 expiresAt = uint64(block.timestamp) + CONSENT_PERIOD;
        consentExpiry[msg.sender][practitioner] = expiresAt;
        emit AccessGranted(msg.sender, practitioner, expiresAt);
    }

    /// @notice Called by the patient: end a practitioner's access at once.
    function revokeAccess(address practitioner) external {
        consentExpiry[msg.sender][practitioner] = 0;
        overrideExpiry[msg.sender][practitioner] = 0;
        emit AccessRevoked(msg.sender, practitioner);
    }

    /// @notice Glass-Break: a verified practitioner opens a record without consent for one hour.
    ///         The event is the permanent audit entry.
    function emergencyAccess(address patient, bytes32 hospitalId) external {
        require(isVerifiedAt(msg.sender, hospitalId), "Unauthorised practitioner");
        require(patient != address(0), "Zero address");
        if (consentExpiry[patient][msg.sender] <= block.timestamp) {
            overrideExpiry[patient][msg.sender] = uint64(block.timestamp) + EMERGENCY_PERIOD;
            emit EmergencyAccessLogged(msg.sender, practitioners[msg.sender].licenseNo, patient, hospitalId, block.timestamp);
        }
    }

    /// @notice The check the API makes before it releases a record.
    function hasAccess(address patient, address practitioner) external view returns (bool) {
        if (practitioners[practitioner].suspendedBy != bytes32(0)) return false;
        return consentExpiry[patient][practitioner] > block.timestamp
            || overrideExpiry[patient][practitioner] > block.timestamp;
    }

    // ------------------------------------------------------------------ anchors and laboratory tokens (relayer)

    function anchorRecord(bytes32 recordId, bytes32 hash, bytes32 hospitalId) external onlyRelayer {
        require(recordHash[recordId] == bytes32(0), "Record already anchored");
        require(hash != bytes32(0), "Empty hash");
        recordHash[recordId] = hash;
        emit RecordAnchored(recordId, hash, hospitalId);
    }

    function anchorAddendum(bytes32 originalRecordId, bytes32 addendumRecordId, bytes32 hash, bytes32 hospitalId)
        external
        onlyRelayer
    {
        require(recordHash[addendumRecordId] == bytes32(0), "Record already anchored");
        require(hash != bytes32(0), "Empty hash");
        recordHash[addendumRecordId] = hash;
        emit RecordAnchored(addendumRecordId, hash, hospitalId);
        emit AddendumAnchored(originalRecordId, addendumRecordId, hash);
    }

    function registerToken(bytes32 tokenHash, bytes32 departmentId, uint64 expiresAt) external onlyRelayer {
        require(!labTokens[tokenHash].exists, "Token already registered");
        labTokens[tokenHash] = LabToken({departmentId: departmentId, expiresAt: expiresAt, exists: true, used: false});
        emit TokenRegistered(tokenHash, departmentId, expiresAt);
    }

    function isTokenValid(bytes32 tokenHash) external view returns (bool) {
        LabToken storage t = labTokens[tokenHash];
        return t.exists && !t.used && t.expiresAt > block.timestamp;
    }

    /// @notice Anchor a laboratory result and invalidate its token so that it cannot be used again.
    function anchorResult(bytes32 tokenHash, bytes32 resultHash) external onlyRelayer {
        LabToken storage t = labTokens[tokenHash];
        require(t.exists, "Unknown token");
        require(!t.used, "Token already used");
        require(t.expiresAt > block.timestamp, "Token expired");
        t.used = true;
        emit ResultAnchored(tokenHash, resultHash);
    }
}
