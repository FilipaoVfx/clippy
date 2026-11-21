import React from 'react';
import {Composition, Folder} from 'remotion';
import './fonts';
import {BRAND, BrandIntro} from './compositions/BrandIntro';
import {DataTransfer, TRANSFER} from './compositions/DataTransfer';
import {CONNECTION, DeviceConnection} from './compositions/DeviceConnection';
import {DevicePairing, PAIRING} from './compositions/DevicePairing';
import {HERO, HeroIntro} from './compositions/HeroIntro';
import {MULTI, MultiDevice} from './compositions/MultiDevice';
import {RECONNECT, Reconnect} from './compositions/Reconnect';
import {CREATED, SessionCreated} from './compositions/SessionCreated';
import {SYNC_CONFIRM, SyncConfirmation} from './compositions/SyncConfirmation';
import {TRANSFER_SEQ, TransferSequence} from './compositions/TransferSequence';

export const Root: React.FC = () => (
  <>
    {/* Shipped on the website (public/assets/motion), per the visual spec. */}
    <Folder name="Web">
      <Composition id="BrandIntro" component={BrandIntro} {...BRAND} />
      <Composition id="SessionCreated" component={SessionCreated} {...CREATED} />
      <Composition id="DevicePairing" component={DevicePairing} {...PAIRING} />
      <Composition id="TransferSequence" component={TransferSequence} {...TRANSFER_SEQ} defaultProps={{contentType: 'text' as const}} />
      <Composition id="SyncConfirmation" component={SyncConfirmation} {...SYNC_CONFIRM} />
    </Folder>
    {/* Longer cuts for sharing outside the site (out/social). */}
    <Folder name="Social">
      <Composition id="HeroIntro" component={HeroIntro} {...HERO} />
      <Composition id="DeviceConnection" component={DeviceConnection} {...CONNECTION} defaultProps={{captions: true}} />
      <Composition id="DataTransfer" component={DataTransfer} {...TRANSFER} defaultProps={{captions: true}} />
      <Composition id="MultiDevice" component={MultiDevice} {...MULTI} defaultProps={{captions: true}} />
      <Composition id="Reconnect" component={Reconnect} {...RECONNECT} defaultProps={{captions: true}} />
    </Folder>
  </>
);
