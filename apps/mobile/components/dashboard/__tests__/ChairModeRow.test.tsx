import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChairModeRow } from '../ChairModeRow';

const base = { label: 'Chair 1', tokenNumber: null, busy: false, hi: false };

describe('ChairModeRow', () => {
  it('free chair: FREE next to the name and an ONLINE switch that takes the chair offline', async () => {
    const onGoOffline = jest.fn();
    const onGoOnline = jest.fn();
    await render(<ChairModeRow {...base} occupancy="FREE" onGoOffline={onGoOffline} onGoOnline={onGoOnline} />);
    expect(screen.getByText('Chair 1')).toBeTruthy();
    expect(screen.getByText('FREE')).toBeTruthy();
    expect(screen.getByText('ONLINE')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Chair 1 online'));
    expect(onGoOffline).toHaveBeenCalledTimes(1);
    expect(onGoOnline).not.toHaveBeenCalled();
  });

  it('offline chair (local customers only): OFFLINE switch brings it back online', async () => {
    const onGoOffline = jest.fn();
    const onGoOnline = jest.fn();
    await render(<ChairModeRow {...base} occupancy="LOCAL" onGoOffline={onGoOffline} onGoOnline={onGoOnline} />);
    expect(screen.getByText('LOCAL ONLY')).toBeTruthy();
    expect(screen.getByText('OFFLINE')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Chair 1 offline'));
    expect(onGoOnline).toHaveBeenCalledTimes(1);
    expect(onGoOffline).not.toHaveBeenCalled();
  });

  it('a chair serving an online customer shows the token and has no switch', async () => {
    await render(<ChairModeRow {...base} occupancy="ONLINE" tokenNumber={7} onGoOffline={jest.fn()} onGoOnline={jest.fn()} />);
    expect(screen.getByText('Token #7')).toBeTruthy();
    expect(screen.queryByText('ONLINE')).toBeNull();
    expect(screen.queryByText('OFFLINE')).toBeNull();
  });

  it('cannot be pressed twice while a request is in flight', async () => {
    const onGoOffline = jest.fn();
    await render(<ChairModeRow {...base} occupancy="FREE" busy onGoOffline={onGoOffline} onGoOnline={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Chair 1 online'));
    expect(onGoOffline).not.toHaveBeenCalled();
  });
});
