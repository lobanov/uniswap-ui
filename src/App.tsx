import './App.css';
import 'bootstrap/dist/css/bootstrap.css';

import Immutable from 'immutable';

import { Navbar, Container, Accordion, Button, Form } from 'react-bootstrap'

import { ethers, BigNumber } from "ethers";
import React, { useState } from 'react';

import erc20 from '@lobanov/uniswap-v2-periphery/build/ERC20.json';
import uniswapV2Router from '@lobanov/uniswap-v2-periphery/build/UniswapV2Router02.json';
import uniswapV2Pair from '@lobanov/uniswap-v2-core/build/UniswapV2Pair.json';
import uniswapV2Factory from '@lobanov/uniswap-v2-core/build/UniswapV2Factory.json';

declare global {
  namespace NodeJS {
    export interface ProcessEnv {
      REACT_APP_NETWORK_CHAIN_ID: string;
      REACT_APP_FACTORY_CONTRACT: string;
      REACT_APP_ROUTER_CONTRACT: string;
      REACT_APP_WETH_CONTRACT: string;
      REACT_APP_BOOTSTRAP_ERC20_CONTRACTS: string;
    }
  }
  
  interface Window {
    ethereum?: any
  }
}

interface IWalletAsset {
  address: string,
  symbol: string,
  decimals: number,
  balance: BigNumber
}

interface IAddTokenFormState {
  contractAddress: string
}

interface ILiquidityFormState {
  tokenSymbol: string,
  wethPairAddress?: string,
  ownedLiquidityBalance?: BigNumber,
  currentPrice?: BigNumber
}

function App() {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const uniswapFactoryContract = new ethers.Contract(process.env.REACT_APP_FACTORY_CONTRACT, uniswapV2Factory.abi, provider);
  const uniswapRouterContract = new ethers.Contract(process.env.REACT_APP_ROUTER_CONTRACT, uniswapV2Router.abi, provider);

  // operation tabs are not visible unless connected to the wallet
  const [ connected, setConnected ] = useState(false);
  // forms are disabled (busy) when waiting for the current transaction to get confirmed
  const [ busy, setBusy ] = useState(false);

  const [ selectedAccount, setSelectedAccount ] = useState("");
  const [ accountBalance, setAccountBalance ] = useState("");

  const [ walletAssets, setWalletAssets ] = useState(Immutable.Map<string, IWalletAsset>());

  const [ tokenAddressFormState, setTokenAddressFormState ] = useState<IAddTokenFormState>({ contractAddress: "" });
  const [ liquidityFormState, setLiquidityFormState ] = useState<ILiquidityFormState>({} as ILiquidityFormState);

  async function connectToMetaMask() {
    console.log("Connecting to MetaMask");
    const accounts = await provider.send("eth_requestAccounts", []);
    const myAccount = accounts[0];
    setSelectedAccount(myAccount);
    const ethBalance = await provider.getBalance(myAccount);
    setAccountBalance(ethers.utils.formatEther(ethBalance));

    const bootstrapTokenContractAddresses = process.env.REACT_APP_BOOTSTRAP_ERC20_CONTRACTS.split(',');
    console.log('Bootstrap token contract addresses:', bootstrapTokenContractAddresses);

    // obtain all uniswap pairs and lookup their tokens
    const knownPairsCount = await uniswapFactoryContract.allPairsLength();
    const knownPairAddresses = await Promise.all(
      Array.from(Array(knownPairsCount).keys()) // 0 ... pairsCount - 1
        .map((index) => 
          uniswapFactoryContract.allPairs(index) as Promise<string>
        )
      );
    const knownTokenContractsAddresses = await Promise.all(
      knownPairAddresses.flatMap((pairAddress) => {
          const pairContract = new ethers.Contract(pairAddress, uniswapV2Pair.abi, provider);
          return [ pairContract.token0() as Promise<string>, pairContract.token1() as Promise<string> ];
        })
      );
    console.log('Token contract addresses known to Uniswap:', knownTokenContractsAddresses);

    // deduplicate
    const allTokenContractAddresses = Immutable.Set<string>(bootstrapTokenContractAddresses.concat(knownTokenContractsAddresses));
    const allTokenContracts = allTokenContractAddresses.map((address) => 
      new ethers.Contract(address, erc20.abi, provider));

    const assets = await Promise.all(allTokenContracts.map(async (contract) => describeWalletAsset(contract, myAccount)));
    assets.forEach(addWalletAsset);

    // make operation tabs visible
    setConnected(true);
  }

  function addWalletAsset(asset: IWalletAsset) {
    setWalletAssets((prev) => {
      if (!prev.has(asset.symbol)) {
        return prev.set(asset.symbol, asset);
      }
      return prev;
    });
  }

  async function describeWalletAsset(contract: ethers.Contract, walletAddress: string): Promise<IWalletAsset> {
    const results = await Promise.all([contract.symbol(), contract.decimals(), contract.balanceOf(walletAddress)]);
    return {
      address: contract.address,
      symbol: results[0] as string,
      decimals: results[1] as number,
      balance: BigNumber.from(results[2])
    } as IWalletAsset;
  }

  function UserInfo() {
    if (!connected) {
      return <Button onClick={connectToMetaMask}>Connect to MetaMask</Button>
    } else {
      return <Container>{`${selectedAccount} (balance: ${accountBalance})`}</Container>
    }
  }

  function WalletAssets() {
    const items = walletAssets.valueSeq().map((asset) =>
      <li key={asset.symbol}>
        <b>{ asset.symbol }</b>{ ': ' + ethers.utils.formatUnits(asset.balance, asset.decimals) }
      </li>
    );
    return <ul>{ items }</ul>;
  }

  function updateTokenAddressFormState(event: React.SyntheticEvent, property: string) {
    event.preventDefault();

    const target = event.target as HTMLInputElement;
    setTokenAddressFormState((prevState) => ({
      ...prevState,
      [property]: target.value,
    }))
  }

  async function handleAddToken(event: React.FormEvent) {
    setBusy(true);
    event.preventDefault();

    const tokenContract = new ethers.Contract(tokenAddressFormState.contractAddress, erc20.abi, provider);
    const asset = await describeWalletAsset(tokenContract, selectedAccount);
    console.log("Adding new ERC20 asset: ", asset);

    addWalletAsset(asset);
    setBusy(false);
  }

  function updateLiquidityFormState(event: React.SyntheticEvent, property: string) {
    event.preventDefault();

    const target = event.target as HTMLInputElement;
    setLiquidityFormState((prevState) => ({
      ...prevState,
      [property]: target.value,
    }))
  }

  const TokensAndBalancesTab = () =>
    <Accordion.Item eventKey="0">
      <Accordion.Header>Tokens and balances</Accordion.Header>
      <Accordion.Body>
        <p>Uniswap V2 Factory contract @ { process.env.REACT_APP_FACTORY_CONTRACT }</p>
        <p>Uniswap V2 Router contract @ { process.env.REACT_APP_ROUTER_CONTRACT }</p>
        <p>Token balances in your wallet:</p>
        <WalletAssets />
        <p>The above shows balances of all tokens for which there is a liquidity pool, plus a few standard ones.</p>
        <p>Use this form to add more ERC-20 token contracts, which could be used in other operations:</p>
        <Form onSubmit={handleAddToken}>
          <Form.Group className="mb-3" controlId="formBasicEmail">
            <Form.Label>Contract address</Form.Label>
            <Form.Control value={tokenAddressFormState.contractAddress}
                onChange={(e) => updateTokenAddressFormState(e, 'contractAddress')}
                disabled={busy}
                type="string"
                placeholder="Enter ERC20 contract address starting with 0x" />
            <Form.Text className="text-muted">
              E.g. WETH9 contract is deployed @ { process.env.REACT_APP_WETH_CONTRACT }
            </Form.Text>
          </Form.Group>
          <Button variant="primary" type="submit" disabled={busy}>
            Submit
          </Button>
        </Form>
      </Accordion.Body>
    </Accordion.Item>

  const LiquidityTab = () =>
    <Accordion.Item eventKey="1">
      <Accordion.Header>Liquidity</Accordion.Header>
      <Accordion.Body>
        <p>This app only supports adding liquidity for trading tokens for ether.</p>
        <p>Select a token to see its liquidity pool status.</p>
        <Form>
          <Form.Group className="mb-3" controlId="token">
            <Form.Label>Token</Form.Label>
            <Form.Select value={liquidityFormState.tokenSymbol}
                onChange={(e) => updateLiquidityFormState(e, 'tokenSymbol')}
                disabled={busy}>
              <option>TEST</option>
            </Form.Select>
            <Form.Text className="text-muted">
              Change to see liquidity details.
            </Form.Text>
          </Form.Group>
        </Form>
        <p>Pair WETH-TEST address: 0x000</p>
        <p>Liquidity tokens owned: 123</p>
        <p>Current price: 1 TEST = 1.234 WETH</p>
        <p>Add liquidity (slippage tolerance is 5%):</p>
        <Form onSubmit={handleAddToken}>
          <Form.Group className="mb-3" controlId="formBasicEmail">
            <Form.Label>Amount of TEST</Form.Label>
            <Form.Control value={tokenAddressFormState.contractAddress}
                onChange={(e) => updateTokenAddressFormState(e, 'contractAddress')}
                disabled={busy}
                type="string"
                placeholder="Enter ERC20 contract address starting with 0x" />
          </Form.Group>
          <Form.Group className="mb-3" controlId="formBasicEmail">
            <Form.Label>Amount of WETH</Form.Label>
            <Form.Control value={tokenAddressFormState.contractAddress}
                onChange={(e) => updateTokenAddressFormState(e, 'contractAddress')}
                disabled={busy}
                type="string"
                placeholder="Enter ERC20 contract address starting with 0x" />
          </Form.Group>
          <Button variant="primary" type="submit" disabled={busy}>
            Submit
          </Button>
        </Form>
      </Accordion.Body>
    </Accordion.Item>

  const TradeTab = () =>
    <Accordion.Item eventKey="2">
      <Accordion.Header>Trading</Accordion.Header>
      <Accordion.Body>Lorem ipsum</Accordion.Body>
    </Accordion.Item>

  function WorkingArea() {
    if (!connected) {
      return <p>Not connect to a provider</p>
    }
    return <Accordion defaultActiveKey="0">
      <TokensAndBalancesTab />
      <LiquidityTab />
      <TradeTab />
    </Accordion>
  }

  return (
    <Container>
      <Navbar bg="light">
        <Container>
          <Navbar.Brand>Forked Uniswap v2 by <a href="https://github.com/lobanov/uniswap-webapp">@lobanov</a></Navbar.Brand>
          <Navbar.Collapse className="justify-content-end">
            <Navbar.Text>
              <UserInfo />
            </Navbar.Text>
          </Navbar.Collapse>
        </Container>
      </Navbar>
      <WorkingArea />      
    </Container>
  );
}

export default App;
