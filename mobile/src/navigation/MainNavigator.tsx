import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import HomeScreen from '../screens/HomeScreen';
import HistoryScreen from '../screens/HistoryScreen';
import OvertimeScreen from '../screens/OvertimeScreen';
import LeaveScreen from '../screens/LeaveScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SubordinateAttendanceScreen from '../screens/SubordinateAttendanceScreen';
import { useAuthState } from '../store/authStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors'

export type MainTabParamList = {
  Home: undefined;
  History: undefined;
  Overtime: { from?: 'history'; attendance_id?: number } | undefined;
  Leave: undefined;
  Team: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<
  keyof MainTabParamList,
  { active: IoniconName; inactive: IoniconName }
> = {
  Home: { active: 'home', inactive: 'home-outline' },
  History: { active: 'time', inactive: 'time-outline' },
  Overtime: { active: 'calendar', inactive: 'calendar-outline' },
  Leave: { active: 'document-text', inactive: 'document-text-outline' },
  Team: { active: 'people', inactive: 'people-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

const TAB_LABELS: Record<keyof MainTabParamList, string> = {
  Home: 'Beranda',
  History: 'Riwayat',
  Overtime: 'Lembur',
  Leave: 'Izin',
  Team: 'Tim',
  Profile: 'Profil',
};

export default function MainNavigator() {
  const role = useAuthState().user?.role;
  const canSeeTeam = role === 'SUPERVISOR' || role === 'ADMIN';
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.action,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          // icon (~28) + label (14) + padding; plus the home-indicator inset
          height: 68 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 14,
          fontWeight: '500',
        },
        tabBarLabel: TAB_LABELS[route.name as keyof MainTabParamList],
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name as keyof MainTabParamList];
          const iconName = focused ? icons.active : icons.inactive;
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Overtime" component={OvertimeScreen} />
      <Tab.Screen name="Leave" component={LeaveScreen} />
      {canSeeTeam && (
        <Tab.Screen name="Team" component={SubordinateAttendanceScreen} />
      )}
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
